precision highp float;

uniform float uTime;
uniform vec2 uResolution;
varying vec2 vUv;
uniform float speed;
uniform int stemCount;
uniform float curvature;
uniform float pulseRate;
uniform float growth;
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
    vec3 color = background * (0.6 + 0.4 * vUv.y);
    for (int i = 0; i < 20; i++) {
        if (i >= stemCount) continue;
        float fi = float(i);
        float seed = fract(sin(fi * 73.17 + 2.0) * 43758.5453);
        float base = ((fi + 0.5) / float(stemCount) - 0.5) * (aspect + 0.2);
        // Neighboring pixels skip the same distant stems; their light is below
        // one output level here, even at maximum brightness.
        if (abs(p.x - base) > curvature * 0.13 + 0.16) continue;
        float height = growth * (0.48 + seed * 0.4 + 0.09 * sin(t * 0.35 + fi));
        float y = clamp(p.y / height, 0.0, 1.0);
        float bend = curvature * 0.13 * y * y * sin(y * 2.3 + fi * 1.7 + t * 0.3);
        float x = base + bend;
        float d = abs(p.x - x);
        float gate = (1.0 - smoothstep(height - aa, height + aa, p.y));
        float stem = (1.0 - smoothstep(0.0015, 0.0015 + aa, d)) * gate;
        float halo = exp(-d * 90.0) * gate;
        float pulse = pow(0.5 + 0.5 * sin(y * 8.0 - t * pulseRate * 2.0 + fi), 10.0);
        vec3 tint = mix(color1, color2, seed);
        color += tint * (stem * (0.35 + pulse) + halo * 0.1);
        // Paired leaves follow the same centerline as the stem.
        for (int j = 0; j < 3; j++) {
            float leafY = (0.28 + float(j) * 0.22);
            float leafBend = curvature * 0.13 * leafY * leafY * sin(leafY * 2.3 + fi * 1.7 + t * 0.3);
            vec2 leaf = p - vec2(base + leafBend, leafY * height);
            float side = mod(fi + float(j), 2.0) * 2.0 - 1.0;
            leaf.x *= side;
            leaf.y -= leaf.x * 0.75;
            float blade = exp(-square((leaf.x - 0.024) / 0.031) - square(leaf.y / 0.009));
            color += tint * blade * (0.25 + 0.3 * pulse);
        }
        float tipX = base + curvature * 0.13 * sin(2.3 + fi * 1.7 + t * 0.3);
        vec2 tip = p - vec2(tipX, height);
        color += tint * exp(-dot(tip, tip) / 0.00012) * 0.9;
    }
    finish(color);
}
