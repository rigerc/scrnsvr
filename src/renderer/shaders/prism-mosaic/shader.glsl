precision highp float;

uniform float uTime;
uniform vec2 uResolution;
varying vec2 vUv;
uniform float speed;
uniform float cellScale;
uniform float edgeGlow;
uniform float distortion;
uniform float bevel;
uniform float brightness;
uniform float saturation;
uniform vec3 color1;
uniform vec3 color2;
uniform vec3 background;

// Match the collection's exposure and color controls; keep black at zero brightness.
void finish(vec3 color) {
    color = 1.0 - exp(-max(color, vec3(0.0)) * brightness);
    float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    color = clamp(color + (dither - 0.5) / 255.0 * min(brightness, 1.0), 0.0, 1.0);
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor = vec4(clamp(mix(vec3(luminance), color, saturation), 0.0, 1.0), 1.0);
}

void main() {
    vec2 p = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0) * cellScale;
    float t = uTime * speed;
    vec2 cell = floor(p);
    vec2 q = fract(p);
    float first = 100.0;
    vec2 nearest = vec2(0.0);
    vec2 nearestId = vec2(0.0);
    // Find the nearest moving site, then the distance to its cell boundaries.
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 neighbor = vec2(float(x), float(y));
        vec2 id = cell + neighbor;
        vec2 seed = vec2(dot(id, vec2(127.1, 311.7)), dot(id, vec2(269.5, 183.3)));
        vec2 point = 0.5 + distortion * 0.28 * sin(t * 0.3 + seed);
        vec2 delta = neighbor + point - q;
        float d = dot(delta, delta);
        if (d < first) { first = d; nearest = delta; nearestId = id; }
    }
    float edge = 10.0;
    for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
        vec2 id = nearestId + vec2(float(x), float(y));
        vec2 seed = vec2(dot(id, vec2(127.1, 311.7)), dot(id, vec2(269.5, 183.3)));
        vec2 point = 0.5 + distortion * 0.28 * sin(t * 0.3 + seed);
        vec2 delta = id - cell + point - q;
        vec2 between = delta - nearest;
        float len = length(between);
        if (len > 0.001) edge = min(edge, dot(0.5 * (delta + nearest), between / len));
    }
    float aa = cellScale / uResolution.y * 1.5;
    float rim = 1.0 - smoothstep(0.0, bevel + aa, edge);
    float glint = 1.0 - smoothstep(0.0, aa * 1.5, edge);
    float palette = 0.5 + 0.5 * sin(dot(nearestId, vec2(1.7, 2.9)) + t * 0.16);
    vec3 tint = mix(color1, color2, palette);
    float facet = 0.65 + 0.22 * sin(nearest.x * 3.0 + nearest.y * 2.0 + t * 0.3);
    vec3 color = mix(background, tint * facet, 0.72) + tint * rim * edgeGlow * 0.55 + glint * edgeGlow * 0.23;
    finish(color);
}
