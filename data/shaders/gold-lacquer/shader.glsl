precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float scale;
uniform float flakeDensity;
uniform float flakeSize;
uniform float shimmer;
uniform float glossWidth;
uniform float brightness;
uniform float saturation;
uniform vec3 highlightColor;
uniform vec3 color1;
uniform vec3 color2;
uniform vec3 background;
#else
#define uTime iTime
#define uResolution iResolution.xy
const float speed = 0.3;
const float scale = 1.0;
const float flakeDensity = 0.5;
const float flakeSize = 0.5;
const float shimmer = 0.5;
const float glossWidth = 1.0;
const float brightness = 1.0;
const float saturation = 1.0;
const vec3 highlightColor = vec3(1.000000, 0.945098, 0.823529);
const vec3 color1 = vec3(0.886275, 0.713725, 0.360784);
const vec3 color2 = vec3(0.360784, 0.078431, 0.078431);
const vec3 background = vec3(0.031373, 0.015686, 0.019608);
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
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 p = ((fragCoord / uResolution) - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
    float t = uTime * speed;
    float px = 1.0 / uResolution.y;
    // Deep lacquer: slow clouds of tint suspended under the surface.
    float cloud = noise(p * 2.2 + vec2(t * 0.01, 0.0)) * 0.6 + noise(p * 5.1 - 3.0) * 0.4;
    vec3 color = mix(background, color2, 0.12 + 0.3 * cloud);
    // The light wanders on a slow loop; a flake glints when its tilt mirrors the light.
    float wander = t * shimmer * 0.22;
    vec2 light = 0.55 * vec2(cos(wander), sin(wander * 0.73 + 0.6));
    float cell = 0.05 / scale;
    vec2 grid = p / cell;
    vec2 base = floor(grid);
    vec3 flakes = vec3(0.0);
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 id = base + vec2(float(i), float(j));
            // Gold gathers in drifts, as if sprinkled by hand, rather than spreading evenly.
            float drift = smoothstep(0.3, 0.75, noise(id * cell * 1.6 * scale + 4.0));
            if (hash(id + 0.31) > flakeDensity * mix(0.08, 1.15, drift)) continue;
            vec2 center = id + 0.15 + 0.7 * vec2(hash(id + 1.7), hash(id + 5.3));
            float angle = hash(id + 9.1) * 3.14159;
            vec2 local = (grid - center) * cell;
            local = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * local;
            // Cut gold leaf: small squares and slivers, slightly skewed. Never thinner than two pixels.
            float radius = max(cell * flakeSize * (0.16 + 0.3 * hash(id + 3.3)), 1.5 * px);
            vec2 sides = radius * vec2(1.0, mix(0.35, 1.0, hash(id + 6.6)));
            sides = max(sides, vec2(1.2 * px));
            local.x += local.y * (hash(id + 5.5) - 0.5) * 0.6;
            vec2 edge = abs(local) - sides;
            float box = length(max(edge, 0.0)) + min(max(edge.x, edge.y), 0.0);
            float shape = 1.0 - smoothstep(-0.7 * px, 0.7 * px, box);
            if (shape <= 0.0) continue;
            vec2 tilt = vec2(hash(id + 2.2), hash(id + 8.8)) * 2.0 - 1.0;
            float match = length(tilt * 0.8 - light);
            float glint = pow(max(1.0 - match / 0.42, 0.0), 2.0);
            float depth = 0.45 + 0.55 * hash(id + 4.4);
            flakes += shape * depth * (color1 * (0.45 + 0.35 * hash(id + 7.7)) + mix(color1, highlightColor, 0.55) * glint * 3.5);
        }
    }
    color += flakes;
    // Fine gold dust settles in the same drifts, a soft glitter between the larger flakes.
    float gather = smoothstep(0.3, 0.75, noise(p * 1.6 * scale + 4.0));
    float dust = pow(noise(fragCoord * 0.45), 6.0) * 3.0 + 0.25;
    color += color1 * gather * dust * flakeDensity * 0.1;
    // A broad, soft reflection of a studio window glides slowly across the gloss.
    vec2 axis = normalize(vec2(0.8, 0.35));
    float position = 0.35 * sin(t * 0.05 + 0.8);
    float across = (dot(p, axis) - position) / (0.11 * glossWidth);
    color += mix(highlightColor, color2, 0.25) * exp(-across * across) * 0.12;
    fragColor = finish(color);
}
