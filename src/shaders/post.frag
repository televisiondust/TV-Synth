precision highp float;

uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform float uScanlineIntensity;
uniform float uCurvature;
uniform float uChromaticAberration;
uniform float uTime;

varying vec2 vUv;

vec2 curve(vec2 uv) {
    uv = (uv - 0.5) * 2.0;
    uv *= 1.1; // slight zoom to hide edges
    uv.x *= 1.0 + pow((abs(uv.y) / 5.0), 2.0) * uCurvature;
    uv.y *= 1.0 + pow((abs(uv.x) / 4.0), 2.0) * uCurvature;
    uv = (uv / 2.0) + 0.5;
    return uv;
}

void main() {
    vec2 uv = curve(vUv);
    
    // Out of bounds check
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    // Chromatic Aberration
    float r = texture2D(tDiffuse, uv + vec2(uChromaticAberration, 0.0)).r;
    float g = texture2D(tDiffuse, uv).g;
    float b = texture2D(tDiffuse, uv - vec2(uChromaticAberration, 0.0)).b;
    
    vec3 color = vec3(r, g, b);
    
    // Scanlines
    float scanline = sin(uv.y * uResolution.y * 1.5) * 0.1;
    color -= scanline * uScanlineIntensity;
    
    // Slight Vingette
    float vignette = uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y);
    vignette = pow(vignette * 15.0, 0.25);
    color *= vignette;
    
    // Phosphor Noise / Grain
    float noise = (fract(sin(dot(uv + uTime * 0.01, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.05;
    color += noise;

    gl_FragColor = vec4(color, 1.0);
}
