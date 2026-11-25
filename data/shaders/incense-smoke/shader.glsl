precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform int wispCount;
uniform float turbulence;
uniform float height;
uniform float drift;
uniform float brightness;
uniform float saturation;
uniform vec3 color1;
uniform vec3 color2;
uniform vec3 background;
#else
#define uTime iTime
#define uResolution iResolution.xy
const float speed = 0.3;
const int wispCount = 3;
const float turbulence = 0.5;
const float height = 0.75;
const float drift = 0.4;
const float brightness = 1.0;
const float saturation = 1.0;
const vec3 color1 = vec3(0.866667, 0.839216, 0.933333);
const vec3 color2 = vec3(0.541176, 0.490196, 0.713725);
const vec3 background = vec3(0.027451, 0.023529, 0.047059);
#endif

// Match the collection's exposure and color controls; keep black at zero brightness.
vec4 finish(vec3 color) {
    color = 1.0 - exp(-max(color, vec3(0.0)) * brightness);
    float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    color = clamp(color + (dither - 0.5) / 255.0 * min(brightness, 1.0), 0.0, 1.0);
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    return vec4(clamp(mix(vec3(luminance), color, saturation), 0.0, 1.0), 1.0);
}

float hash(float n) {
    return fract(sin(n * 127.1) * 43758.5453);
}

float noise(float x) {
    float i = floor(x);
    float f = fract(x);
    return mix(hash(i), hash(i + 1.0), f * f * (3.0 - 2.0 * f)) * 2.0 - 1.0;
}

// Sideways offset of a strand at height y. Smoke rises straight, then curls and breaks up.
vec2 strand(float y, float t, float seed) {
    float rise = y * 3.2 - t * 0.55;
    float calm = smoothstep(0.02, 0.35, y);
    float curl = turbulence * calm * y;
    float x = 0.11 * curl * sin(rise * 2.1 + seed * 6.0 + 0.6 * sin(rise * 0.9 + seed))
        + 0.07 * curl * noise(rise * 1.3 + seed * 13.0)
        + 0.025 * calm * sin(y * 5.0 - t * 0.3 + seed * 4.0);
    // Slope dx/dy, by finite difference, for a width that stays even across steep curls.
    float y2 = y + 0.004;
    float rise2 = y2 * 3.2 - t * 0.55;
    float calm2 = smoothstep(0.02, 0.35, y2);
    float curl2 = turbulence * calm2 * y2;
    float x2 = 0.11 * curl2 * sin(rise2 * 2.1 + seed * 6.0 + 0.6 * sin(rise2 * 0.9 + seed))
        + 0.07 * curl2 * noise(rise2 * 1.3 + seed * 13.0)
        + 0.025 * calm2 * sin(y2 * 5.0 - t * 0.3 + seed * 4.0);
    return vec2(x, (x2 - x) / 0.004);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / uResolution;
    float aspect = uResolution.x / uResolution.y;
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y);
    float t = uTime * speed;
    float px = 1.0 / uResolution.y;
    float y = p.y;
    float count = float(wispCount);
    vec3 color = background;
    // A slow air current leans every plume the same way, more as it rises.
    float current = drift * 0.18 * y * y * sin(t * 0.05 + 0.7);
    float fade = 1.0 - smoothstep(height * 0.35, height, y);
    for (int w = 0; w < 5; w++) {
        if (w >= wispCount) break;
        float fw = float(w);
        float origin = ((fw + 0.5) / count - 0.5) * min(aspect, 1.6) * 0.75;
        vec3 tint = mix(color1, color2, 0.3 + 0.5 * hash(fw + 2.0));
        // Each plume is a few filaments that start together and drift apart as they climb.
        for (int s = 0; s < 3; s++) {
            float seed = fw * 3.0 + float(s) + 1.0;
            vec2 path = strand(y, t, seed * 0.37 + fw);
            float spread = (float(s) - 1.0) * 0.012 * smoothstep(0.1, 0.7, y) * (0.5 + turbulence);
            float dx = p.x - (origin + path.x + spread + current);
            float distance = abs(dx) / sqrt(1.0 + path.y * path.y);
            float width = px * 0.9 + 0.0015 + 0.012 * y * y;
            float density = exp(-distance * distance / (width * width));
            // Thin smoke is brightest low down; as it widens the same smoke spreads thinner.
            float body = (0.0025 + px) / width;
            color += tint * density * body * fade * smoothstep(0.0, 0.05, y) * 0.55;
        }
        // The ember at the base of the plume.
        vec2 ember = p - vec2(origin, 0.012);
        color += mix(color2, vec3(1.0, 0.55, 0.25), 0.6) * exp(-dot(ember, ember) / 0.00004) * 0.6;
    }
    fragColor = finish(color);
}
