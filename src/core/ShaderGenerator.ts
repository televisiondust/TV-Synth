import { ModuleGraph, type ModuleState } from './ModuleGraph';

export class ShaderGenerator {
    static generateFragmentShader(graph: ModuleGraph): string {
        let shader = `
precision highp float;
uniform float uTime;
uniform vec2 uResolution;
uniform sampler2D tFeedback;
uniform sampler2D tCam;    // webcam feed (black if inactive)
uniform sampler2D tScreen; // screen capture (black if inactive)
varying vec2 vUv;

const float PI  = 3.14159265359;
const float TAU = 6.28318530718;

// Oscillator waveforms — returns 0..1
float getOsc(float val, int type) {
    if (type == 1) return step(0.5, fract(val));
    if (type == 2) return abs(fract(val) * 2.0 - 1.0);
    if (type == 3) return fract(val);
    return sin(val * TAU) * 0.5 + 0.5;
}

// Spatial ramp — returns 0..1
float getRamp(vec2 uv, int dir) {
    if (dir == 1) return uv.y;
    if (dir == 2) return length(uv - 0.5) * 2.0;
    if (dir == 3) return fract(uv.x + uv.y);
    return uv.x;
}

// Value noise
float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
}
float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
        mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
        f.y
    );
}

// HSV <-> RGB
vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

void main() {
    vec2 uv = vUv;
    vec3 finalColor = vec3(0.0);
`;

        const modules = this.topoSort(graph);
        modules.forEach(mod => {
            if (mod.type !== 'OUTPUT') {
                shader += this.generateChunk(mod, graph);
            }
        });

        // Resolve final color from OUTPUT node's incoming connection
        const outputMod = modules.find(m => m.type === 'OUTPUT');
        if (outputMod) {
            const conn = graph.connections.find(c => c.toId === outputMod.id && c.inputName === 'signal');
            if (conn) {
                shader += `\n    finalColor = out_${conn.fromId};\n`;
            }
        } else {
            const nonOutput = modules.filter(m => m.type !== 'OUTPUT');
            if (nonOutput.length > 0) {
                shader += `\n    finalColor = out_${nonOutput[nonOutput.length - 1].id};\n`;
            }
        }

        shader += `
    gl_FragColor = vec4(clamp(finalColor, 0.0, 1.0), 1.0);
}
`;
        return shader;
    }

    // Topological sort — ensures dependencies are declared before the modules that use them
    private static topoSort(graph: ModuleGraph): ModuleState[] {
        const visited = new Set<string>();
        const result: ModuleState[] = [];

        const visit = (id: string) => {
            if (visited.has(id)) return;
            visited.add(id);
            graph.connections
                .filter(c => c.toId === id)
                .forEach(c => visit(c.fromId));
            const mod = graph.modules.get(id);
            if (mod) result.push(mod);
        };

        Array.from(graph.modules.keys()).forEach(id => visit(id));
        return result;
    }

    // Safe GLSL float literal
    private static f(val: any, fallback = 0): string {
        const n = parseFloat(val);
        return isNaN(n) ? fallback.toFixed(4) : n.toFixed(4);
    }

    private static i(val: any): number {
        return parseInt(val) || 0;
    }

    // Returns the GLSL vec3 expression for a named input port, or a fallback
    private static inp(toId: string, inputName: string, graph: ModuleGraph, fallback = 'vec3(0.0)'): string {
        const conn = graph.connections.find(c => c.toId === toId && c.inputName === inputName);
        return conn ? `out_${conn.fromId}` : fallback;
    }

    // Returns the vec2 UV expression for a 'uv' input port, or the global 'uv'
    private static getUv(toId: string, graph: ModuleGraph): string {
        const conn = graph.connections.find(c => c.toId === toId && c.inputName === 'uv');
        return conn ? `out_${conn.fromId}.xy` : 'uv';
    }

    private static generateChunk(mod: ModuleState, graph: ModuleGraph): string {
        const id = mod.id;
        let c = `\n    // [${mod.type}] ${id.slice(0, 8)}\n`;

        switch (mod.type) {

            // ── Sources ────────────────────────────────────────────────────────

            case 'OSC': {
                const uvE   = this.getUv(id, graph);
                const dir   = this.i(mod.params.dir);
                const freq  = this.f(mod.params.freq, 5);
                const speed = this.f(mod.params.speed, 1);
                const type  = this.i(mod.params.type);
                const chroma = this.f(mod.params.chromaOffset, 0);
                c += `    vec3 out_${id} = vec3(\n`;
                c += `        getOsc(getRamp(${uvE}, ${dir}) * ${freq} + uTime * ${speed} + ${chroma}, ${type}),\n`;
                c += `        getOsc(getRamp(${uvE}, ${dir}) * ${freq} + uTime * ${speed},             ${type}),\n`;
                c += `        getOsc(getRamp(${uvE}, ${dir}) * ${freq} + uTime * ${speed} - ${chroma}, ${type})\n`;
                c += `    );\n`;
                break;
            }

            case 'NOISE': {
                const uvE   = this.getUv(id, graph);
                const scale = this.f(mod.params.scale, 4);
                const speed = this.f(mod.params.speed, 0.5);
                c += `    vec3 out_${id} = vec3(valueNoise(${uvE} * ${scale} + uTime * ${speed}));\n`;
                break;
            }

            case 'SHAPE': {
                const uvE    = this.getUv(id, graph);
                const type   = this.i(mod.params.type);
                const radius = this.f(mod.params.radius, 0.4);
                const smooth = this.f(Math.max(parseFloat(mod.params.smooth ?? 0.02), 0.001), 0.02);
                if (type === 1) {
                    c += `    float dist_${id} = max(abs(${uvE}.x - 0.5), abs(${uvE}.y - 0.5)) * 2.0;\n`;
                } else if (type === 2) {
                    c += `    float dist_${id} = min(abs(${uvE}.x - 0.5), abs(${uvE}.y - 0.5)) * 2.0;\n`;
                } else {
                    c += `    float dist_${id} = length(${uvE} - 0.5) * 2.0;\n`;
                }
                c += `    vec3 out_${id} = vec3(1.0 - smoothstep(${radius} - ${smooth}, ${radius} + ${smooth}, dist_${id}));\n`;
                break;
            }

            // ── Color / mix ────────────────────────────────────────────────────

            case 'COLOR': {
                const src        = this.inp(id, 'src', graph);
                const hue        = this.f(mod.params.hue, 0);
                const saturation = this.f(mod.params.saturation, 1);
                const brightness = this.f(mod.params.brightness, 1);
                const contrast   = this.f(mod.params.contrast, 1);
                c += `    vec3 hsv_${id} = rgb2hsv(${src});\n`;
                c += `    hsv_${id}.x = fract(hsv_${id}.x + ${hue});\n`;
                c += `    hsv_${id}.y = clamp(hsv_${id}.y * ${saturation}, 0.0, 1.0);\n`;
                c += `    hsv_${id}.z = clamp(hsv_${id}.z * ${brightness}, 0.0, 1.0);\n`;
                c += `    vec3 out_${id} = clamp((hsv2rgb(hsv_${id}) - 0.5) * ${contrast} + 0.5, 0.0, 1.0);\n`;
                break;
            }

            case 'BLEND': {
                const mode     = this.i(mod.params.mode);
                const amount   = this.f(mod.params.amount, 0.5);
                const fallback = mode === 2 ? 'vec3(1.0)' : 'vec3(0.0)';
                const a = this.inp(id, 'a', graph, fallback);
                const b = this.inp(id, 'b', graph, fallback);
                const ops: Record<number, string> = {
                    0: `mix(${a}, ${b}, ${amount})`,
                    1: `(${a} + ${b}) * 0.5`,
                    2: `${a} * ${b}`,
                    3: `abs(${a} - ${b})`,
                    4: `1.0 - (1.0 - ${a}) * (1.0 - ${b})`,
                };
                c += `    vec3 out_${id} = ${ops[mode] ?? ops[0]};\n`;
                break;
            }

            case 'FEEDBACK': {
                const src   = this.inp(id, 'src', graph, 'vec3(0.0)');
                const decay = this.f(mod.params.decay, 0.8);
                c += `    vec3 out_${id} = mix(${src}, texture2D(tFeedback, uv).rgb, ${decay});\n`;
                break;
            }

            // ── UV Transforms ──────────────────────────────────────────────────
            // All transform outputs are vec3(u, v, 0.0) — connect to any 'uv' input port

            case 'ROTATE': {
                const uvE   = this.getUv(id, graph);
                const angle = this.f(mod.params.angle, 0);
                const speed = this.f(mod.params.speed, 0);
                c += `    vec2 rUv_${id} = ${uvE} - 0.5;\n`;
                c += `    float rAng_${id} = ${angle} + uTime * ${speed};\n`;
                c += `    vec3 out_${id} = vec3(\n`;
                c += `        rUv_${id}.x * cos(rAng_${id}) - rUv_${id}.y * sin(rAng_${id}) + 0.5,\n`;
                c += `        rUv_${id}.x * sin(rAng_${id}) + rUv_${id}.y * cos(rAng_${id}) + 0.5,\n`;
                c += `        0.0\n    );\n`;
                break;
            }

            case 'SCALE': {
                const uvE = this.getUv(id, graph);
                const sx  = this.f(mod.params.sx, 1);
                const sy  = this.f(mod.params.sy, 1);
                c += `    vec3 out_${id} = vec3((${uvE} - 0.5) / vec2(${sx}, ${sy}) + 0.5, 0.0);\n`;
                break;
            }

            case 'SCROLL': {
                const uvE    = this.getUv(id, graph);
                const tx     = this.f(mod.params.tx, 0);
                const ty     = this.f(mod.params.ty, 0);
                const speedX = this.f(mod.params.speedX, 0.1);
                const speedY = this.f(mod.params.speedY, 0);
                c += `    vec3 out_${id} = vec3(fract(${uvE} + vec2(${tx} + uTime * ${speedX}, ${ty} + uTime * ${speedY})), 0.0);\n`;
                break;
            }

            case 'KALEID': {
                const uvE   = this.getUv(id, graph);
                const sides = Math.max(2, this.i(mod.params.sides) || 4);
                c += `    vec2 kUv_${id} = ${uvE} - 0.5;\n`;
                c += `    float kR_${id}   = length(kUv_${id});\n`;
                c += `    float kTh_${id}  = atan(kUv_${id}.y, kUv_${id}.x);\n`;
                c += `    float kSeg_${id} = TAU / ${sides}.0;\n`;
                c += `    kTh_${id} = mod(kTh_${id}, kSeg_${id});\n`;
                c += `    kTh_${id} = abs(kTh_${id} - kSeg_${id} * 0.5);\n`;
                c += `    vec3 out_${id} = vec3(kR_${id} * cos(kTh_${id}) + 0.5, kR_${id} * sin(kTh_${id}) + 0.5, 0.0);\n`;
                break;
            }

            case 'PIXELATE': {
                const uvE    = this.getUv(id, graph);
                const pixels = this.f(mod.params.pixels, 32);
                c += `    vec3 out_${id} = vec3(floor(${uvE} * ${pixels}) / ${pixels}, 0.0);\n`;
                break;
            }

            case 'WARP': {
                // src input is the warp field; its RG channels displace the UV
                const uvE    = this.getUv(id, graph);
                const src    = this.inp(id, 'src', graph, 'vec3(0.5)');
                const amount = this.f(mod.params.amount, 0.2);
                c += `    vec3 out_${id} = vec3(fract(${uvE} + (${src}.xy - 0.5) * ${amount}), 0.0);\n`;
                break;
            }

            case 'MIRROR': {
                const uvE = this.getUv(id, graph);
                const mx  = this.f(mod.params.mirrorX ?? 1, 1);
                const my  = this.f(mod.params.mirrorY ?? 0, 0);
                // mix(original, folded, toggle) — fold = abs(fract(u)*2-1)
                c += `    vec2 mUv_${id} = ${uvE};\n`;
                c += `    mUv_${id}.x = mix(mUv_${id}.x, abs(fract(mUv_${id}.x) * 2.0 - 1.0), ${mx});\n`;
                c += `    mUv_${id}.y = mix(mUv_${id}.y, abs(fract(mUv_${id}.y) * 2.0 - 1.0), ${my});\n`;
                c += `    vec3 out_${id} = vec3(mUv_${id}, 0.0);\n`;
                break;
            }

            case 'CAMERA': {
                const uvE = this.getUv(id, graph);
                // flip=1 mirrors X (typical for selfie/webcam)
                const flip = this.i(mod.params.flip ?? 1);
                const sample = flip
                    ? `vec2(1.0 - ${uvE}.x, ${uvE}.y)`
                    : uvE;
                c += `    vec3 out_${id} = texture2D(tCam, ${sample}).rgb;\n`;
                break;
            }

            case 'SCREEN': {
                const uvE = this.getUv(id, graph);
                c += `    vec3 out_${id} = texture2D(tScreen, ${uvE}).rgb;\n`;
                break;
            }

            default:
                c += `    vec3 out_${id} = vec3(0.0);\n`;
        }

        return c;
    }
}
