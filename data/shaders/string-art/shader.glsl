precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform int pins;
uniform float size;
uniform float multiplier;
uniform float morph;
uniform float lineWidth;
uniform float brightness;
uniform float saturation;
uniform vec3 color1;
uniform vec3 color2;
uniform vec3 background;
#else
#define uTime iTime
#define uResolution iResolution.xy
const float speed = 0.3;
const int pins = 120;
const float size = 0.42;
const float multiplier = 2.0;
const float morph = 0.5;
const float lineWidth = 1.0;
const float brightness = 1.0;
const float saturation = 1.0;
const vec3 color1 = vec3(0.941176, 0.760784, 0.478431);
const vec3 color2 = vec3(0.498039, 0.705882, 0.909804);
const vec3 background = vec3(0.043137, 0.062745, 0.098039);
#endif

// Match the collection's exposure and color controls; keep black at zero brightness.
vec4 finish(vec3 color) {
    color = 1.0 - exp(-max(color, vec3(0.0)) * brightness);
    float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    color = clamp(color + (dither - 0.5) / 255.0 * min(brightness, 1.0), 0.0, 1.0);
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    return vec4(clamp(mix(vec3(luminance), color, saturation), 0.0, 1.0), 1.0);
}

float segmentDistance(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    return length(pa - ba * h);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 p = ((fragCoord / uResolution) - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
    float t = uTime * speed;
    float px = 1.0 / uResolution.y;
    float count = float(pins);
    float radius = size;
    // Ease back and forth through four whole patterns so the curve never jumps.
    float factor = multiplier + 2.0 * (1.0 - cos(t * morph * 0.05));
    float turn = t * 0.02;
    float core = 0.0004 * lineWidth;
    float aa = 1.2 * px;
    vec3 color = background;
    float r = length(p);
    if (r < radius + 4.0 * px) {
        vec3 threads = vec3(0.0);
        for (int i = 0; i < 200; i++) {
            if (i >= pins) break;
            float fi = float(i);
            float a1 = 6.2831853 * fi / count + turn;
            float a2 = 6.2831853 * mod(fi * factor, count) / count + turn;
            vec2 a = radius * vec2(cos(a1), sin(a1));
            vec2 b = radius * vec2(cos(a2), sin(a2));
            float d = segmentDistance(p, a, b);
            float line = 1.0 - smoothstep(core, core + aa, d);
            float span = length(b - a) / (2.0 * radius);
            vec3 tint = mix(color1, color2, smoothstep(0.15, 0.95, span));
            threads += tint * (line * 0.32 + exp(-d * 900.0) * 0.012);
        }
        color += threads;
    }
    // Brass pins and the faint rim they sit on.
    float pinAngle = atan(p.y, p.x) - turn;
    float step = 6.2831853 / count;
    float nearest = floor(pinAngle / step + 0.5) * step + turn;
    vec2 pin = radius * vec2(cos(nearest), sin(nearest));
    float pinGlow = 1.0 - smoothstep(1.2 * px, 2.6 * px, length(p - pin));
    color += color1 * pinGlow * 0.9;
    color += mix(color1, color2, 0.5) * 0.08 * (1.0 - smoothstep(0.0, 1.5 * px, abs(r - radius)));
    fragColor = finish(color);
}
