precision highp float;

uniform float uTime;
uniform vec2 uResolution;
varying vec2 vUv;
uniform float speed;
uniform int symmetry;
uniform float lineSpacing;
uniform float weave;
uniform float rotation;
uniform float lineWidth;
uniform float brightness;
uniform float saturation;
uniform vec3 color1;
uniform vec3 color2;
uniform vec3 background;

// Square explicitly: pow() is undefined for negative bases in GLSL.
float square(float x) { return x * x; }

// Match the collection's exposure and color controls; keep black at zero brightness.
void finish(vec3 color) {
    color = 1.0 - exp(-max(color, vec3(0.0)) * brightness);
    float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    color = clamp(color + (dither - 0.5) / 255.0 * min(brightness, 1.0), 0.0, 1.0);
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor = vec4(clamp(mix(vec3(luminance), color, saturation), 0.0, 1.0), 1.0);
}

void main() {
    vec2 p = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
    float t = uTime * speed;
    float r = length(p);
    float theta = atan(p.y, p.x + 0.000001) + t * rotation * 0.12;
    float aa = 1.3 / uResolution.y;
    vec3 color = background;
    for (int i = 0; i < 22; i++) {
        float fi = float(i);
        float phase = fi * 0.31;
        float radius = 0.07 + fi * lineSpacing;
        float amplitude = weave * radius / (radius + 0.08);
        float a = theta * float(symmetry) + phase + t * 0.19;
        float b = theta * float(symmetry * 2) - phase - t * 0.13;
        radius += amplitude * (0.045 * sin(a) + 0.018 * sin(b));
        // Convert radial error to distance across the curve. This keeps steep
        // inner lobes smooth without requiring WebGL 1 derivative extensions.
        float slope = amplitude * float(symmetry) * (0.045 * cos(a) + 0.036 * cos(b));
        float gradient = sqrt(1.0 + square(slope / max(r, 0.015)));
        float d = abs(r - radius) / gradient;
        float line = 1.0 - smoothstep(0.0008 * lineWidth, 0.0008 * lineWidth + aa, d);
        float glow = exp(-d * 160.0) * 0.08;
        vec3 tint = mix(color1, color2, 0.5 + 0.5 * sin(phase + theta * 2.0));
        color += tint * (line * 0.7 + glow);
    }
    finish(color);
}
