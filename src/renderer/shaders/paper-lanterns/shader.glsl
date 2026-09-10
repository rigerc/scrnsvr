precision highp float;

uniform float uTime;
uniform vec2 uResolution;
varying vec2 vUv;
uniform float speed;
uniform int lanternCount;
uniform float sway;
uniform float translucency;
uniform float size;
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
    float aspect = uResolution.x / uResolution.y;
    vec2 p = vec2((vUv.x - 0.5) * aspect, vUv.y);
    float t = uTime * speed;
    float aa = 1.5 / uResolution.y;
    vec3 color = background * (0.6 + 0.4 * (1.0 - vUv.y));
    for (int i = 0; i < 20; i++) {
        if (i >= lanternCount) continue;
        float fi = float(i);
        float seed = fract(sin(fi * 73.13 + 5.1) * 43758.5453);
        float depth = 0.45 + 0.55 * seed;
        float travel = fract(seed + t * (0.018 + seed * 0.012));
        float y = travel * 1.5 - 0.25;
        float x = (fract(seed * 17.31) - 0.5) * (aspect + 0.2);
        x += sway * 0.09 * sin(t * 0.37 + fi * 2.1);
        vec2 q = (p - vec2(x, y)) / (size * depth);
        // The halo has decayed below output precision outside this radius.
        if (dot(q, q) > 0.16) continue;
        float angle = sway * 0.13 * sin(t * 0.3 + fi);
        q = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * q;
        float width = 0.035 * (1.0 + 0.22 * cos(q.y * 30.0));
        float localAA = aa / (size * depth);
        float body = (1.0 - smoothstep(width - localAA, width + localAA, abs(q.x)))
            * (1.0 - smoothstep(0.054 - localAA, 0.054 + localAA, abs(q.y)));
        float ribs = pow(0.5 + 0.5 * cos(q.x * 230.0), 12.0);
        float flame = exp(-square(q.x / 0.015) - square((q.y + 0.034) / 0.023));
        float glow = exp(-dot(q, q) * 130.0);
        vec3 tint = mix(color1, color2, seed);
        vec3 paper = tint * (0.32 + translucency * (0.7 - ribs * 0.18)) + flame * color1 * 0.8;
        float fade = smoothstep(0.0, 0.12, travel) * (1.0 - smoothstep(0.88, 1.0, travel));
        color = mix(color, paper, body * fade * 0.9);
        color += tint * glow * translucency * 0.14 * fade;
    }
    finish(color);
}
