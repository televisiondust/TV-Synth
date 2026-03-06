precision highp float;

uniform float uTime;
uniform vec2 uResolution;

// Oscillator 1
uniform float uOsc1Freq;
uniform float uOsc1Speed;
uniform int uOsc1Type; // 0: Sine, 1: Square, 2: Triangle, 3: Saw
uniform int uOsc1Dir;  // 0: Horizontal, 1: Vertical, 2: Circular

// Oscillator 2
uniform float uOsc2Freq;
uniform float uOsc2Speed;
uniform int uOsc2Type;
uniform int uOsc2Dir;

// Modulation / Mix
uniform int uMixMode; // 0: Add, 1: Multiply, 2: XOR-ish, 3: Min, 4: Max

uniform sampler2D tFeedback;
uniform float uFeedbackAmount;

varying vec2 vUv;

const float PI = 3.14159265359;

float getOsc(float val, int type) {
    if (type == 1) { // Square
        return step(0.5, fract(val)) * 2.0 - 1.0;
    } else if (type == 2) { // Triangle
        return abs(fract(val) * 2.0 - 1.0) * 2.0 - 1.0;
    } else if (type == 3) { // Saw
        return fract(val) * 2.0 - 1.0;
    }
    return sin(val * 6.28318); // Sine (default)
}

float getRamp(vec2 uv, int dir) {
    if (dir == 1) return uv.y; // Vertical
    if (dir == 2) return length(uv - 0.5) * 2.0; // Circular/Radial
    return uv.x; // Horizontal (default)
}

void main() {
    vec2 uv = vUv;
    
    // Generator 1
    float ramp1 = getRamp(uv, uOsc1Dir);
    float sig1 = getOsc(ramp1 * uOsc1Freq + uTime * uOsc1Speed, uOsc1Type);
    
    // Generator 2
    float ramp2 = getRamp(uv, uOsc2Dir);
    float sig2 = getOsc(ramp2 * uOsc2Freq + uTime * uOsc2Speed, uOsc2Type);
    
    // Mix Logic
    float result = 0.0;
    if (uMixMode == 0) { // Add
        result = (sig1 + sig2) * 0.5;
    } else if (uMixMode == 1) { // Multiply
        result = sig1 * sig2;
    } else if (uMixMode == 2) { // Diff / XOR-ish
        result = abs(sig1 - sig2);
    } else if (uMixMode == 3) { // Min
        result = min(sig1, sig2);
    } else if (uMixMode == 4) { // Max
        result = max(sig1, sig2);
    }
    
    // Final signal normalized to 0..1
    float finalSig = result * 0.5 + 0.5;
    
    // Sample Feedback
    vec4 fb = texture2D(tFeedback, uv);
    
    // Blend Oscillator with Feedback
    vec3 color = mix(vec3(finalSig), fb.rgb, uFeedbackAmount);
    
    gl_FragColor = vec4(color, 1.0);
}
