precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform int rayCount;
uniform float depth;
uniform float motes;
uniform float sway;
uniform float brightness;
uniform float saturation;
uniform vec3 color1;
uniform vec3 color2;
uniform vec3 background;
#else
#define uTime iTime
#define uResolution iResolution.xy
const float speed = 0.3;
const int rayCount = 6;
const float depth = 0.6;
const float motes = 0.5;
const float sway = 0.5;
const float brightness = 1.0;
const float saturation = 1.0;
const vec3 color1 = vec3(0.623529, 0.909804, 0.874510);
const vec3 color2 = vec3(0.239216, 0.486275, 0.752941);
const vec3 background = vec3(0.011765, 0.062745, 0.105882);
#endif

// Match the collection's exposure and color controls; keep black at zero brightness.
vec4 finish(vec3 color) {
    color = 1.0 - exp(-max(color, vec3(0.0)) * brightness);
    float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    color = clamp(color + (dither - 0.5) / 255.0 * min(brightness, 1.0), 0.0, 1.0);
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    return vec4(clamp(mix(vec3(luminance), color, saturation), 0.0, 1.0), 1.0);
}

float hash(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
}

float noise(float x) {
    float i = floor(x);
    float f = fract(x);
    return mix(hash(vec2(i, 1.7)), hash(vec2(i + 1.0, 1.7)), f * f * (3.0 - 2.0 * f));
}

// Shaft brightness at p: soft beams fanning down from a sun above the surface.
float shafts(vec2 p, float t, float aspect) {
    vec2 source = vec2(0.12 * aspect, 1.25);
    float theta = atan(p.x - source.x, source.y - p.y);
    float count = float(rayCount);
    float total = 0.0;
    for (int i = 0; i < 9; i++) {
        if (i >= rayCount) break;
        float fi = float(i);
        float lane = (fi + 0.5) / count - 0.5;
        float center = lane * 1.15 + sway * 0.05 * sin(t * 0.21 + fi * 1.7) + 0.03 * sin(t * 0.07 + fi * 2.9);
        float width = (0.03 + 0.045 * hash(vec2(fi, 3.1))) * (1.0 + 0.35 * sin(t * 0.17 + fi * 2.3));
        float strength = 0.55 + 0.45 * sin(t * 0.13 + fi * 2.37);
        float x = (theta - center) / width;
        total += exp(-x * x) * strength;
    }
    return total;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / uResolution;
    float aspect = uResolution.x / uResolution.y;
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y);
    float t = uTime * speed;
    float px = 1.0 / uResolution.y;
    float below = 1.0 - uv.y;
    // Light falls off with depth; Reach stretches how far it carries.
    float reach = exp(-below * mix(4.2, 1.1, depth));
    vec3 water = background + color2 * 0.22 * uv.y * uv.y * mix(0.6, 1.0, depth);
    float beams = shafts(p, t, aspect);
    // The rippling surface brightens and dims the beams together.
    float ripple = 0.75 + 0.25 * noise(p.x * 9.0 + t * 0.6) * noise(p.x * 4.0 - t * 0.4 + 5.0);
    vec3 color = water + mix(color2, color1, 0.35 + 0.65 * reach) * beams * reach * ripple * 0.5;
    float surface = exp(-below * 28.0) * (0.5 + 0.5 * noise(p.x * 14.0 + t * 0.9));
    color += color1 * surface * 0.55;
    // Motes: one per cell, drifting slowly; they only shine inside a shaft.
    vec2 field = p * vec2(16.0, 16.0) + vec2(0.0, t * 0.08);
    vec2 cell = floor(field);
    float seed = hash(cell);
    if (seed < motes * 0.8) {
        vec2 offset = vec2(hash(cell + 7.3), hash(cell + 2.1)) * 0.6 + 0.2;
        offset += 0.12 * vec2(sin(t * 0.4 + seed * 31.0), cos(t * 0.33 + seed * 17.0));
        vec2 delta = (fract(field) - offset) / 16.0;
        float radius = max(px * 1.1, 0.0016 + 0.0024 * hash(cell + 9.7));
        float mote = exp(-dot(delta, delta) / (radius * radius));
        float lit = 0.12 + 1.6 * beams * reach;
        color += mix(color1, vec3(1.0), 0.3) * mote * lit * 0.8;
    }
    fragColor = finish(color);
}
