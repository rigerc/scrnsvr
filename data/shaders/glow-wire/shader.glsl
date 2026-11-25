precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform int knot;
uniform float size;
uniform float glow;
uniform float tumble;
uniform float brightness;
uniform float saturation;
uniform vec3 color1;
uniform vec3 color2;
uniform vec3 background;
#else
#define uTime iTime
#define uResolution iResolution.xy
const float speed = 0.3;
const int knot = 2;
const float size = 0.32;
const float glow = 0.5;
const float tumble = 0.5;
const float brightness = 1.0;
const float saturation = 1.0;
const vec3 color1 = vec3(1.000000, 0.811765, 0.541176);
const vec3 color2 = vec3(0.435294, 0.549020, 1.000000);
const vec3 background = vec3(0.019608, 0.023529, 0.050980);
#endif

// Match the collection's exposure and color controls; keep black at zero brightness.
vec4 finish(vec3 color) {
    color = 1.0 - exp(-max(color, vec3(0.0)) * brightness);
    float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    color = clamp(color + (dither - 0.5) / 255.0 * min(brightness, 1.0), 0.0, 1.0);
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    return vec4(clamp(mix(vec3(luminance), color, saturation), 0.0, 1.0), 1.0);
}

const int SEGMENTS = 144;

// A (p, p + 1) torus knot, turned in space; xy is the projected point, z the depth in -1..1.
vec3 knotPoint(float a, float windings, mat3 turn) {
    float tube = cos((windings + 1.0) * a) + 2.0;
    vec3 point = vec3(tube * cos(windings * a), tube * sin(windings * a), -sin((windings + 1.0) * a)) / 3.0;
    point = turn * point;
    float perspective = 1.0 / (1.0 - point.z * 0.22);
    return vec3(point.xy * perspective * size, point.z);
}

float segmentParameter(vec2 p, vec2 a, vec2 b) {
    vec2 ba = b - a;
    return clamp(dot(p - a, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 p = ((fragCoord / uResolution) - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
    float t = uTime * speed;
    float px = 1.0 / uResolution.y;
    float ax = 0.6 + t * tumble * 0.17;
    float ay = t * tumble * 0.11;
    float az = t * 0.03;
    mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, cos(ax), sin(ax), 0.0, -sin(ax), cos(ax));
    mat3 ry = mat3(cos(ay), 0.0, -sin(ay), 0.0, 1.0, 0.0, sin(ay), 0.0, cos(ay));
    mat3 rz = mat3(cos(az), sin(az), 0.0, -sin(az), cos(az), 0.0, 0.0, 0.0, 1.0);
    mat3 turn = rz * ry * rx;
    float windings = float(knot);
    vec3 color = background;
    if (length(p) < size * 1.35 + 0.08) {
        float best = 1e5;
        float bestDepth = 0.0;
        float halo = 0.0;
        vec3 previous = knotPoint(0.0, windings, turn);
        for (int i = 1; i <= SEGMENTS; i++) {
            // The last segment ends exactly where the first began, so the loop has no seam.
            float a = 6.2831853 * float(i) / float(SEGMENTS);
            vec3 current = knotPoint(a, windings, turn);
            float h = segmentParameter(p, previous.xy, current.xy);
            vec2 closest = mix(previous.xy, current.xy, h);
            float d = length(p - closest);
            float depth = mix(previous.z, current.z, h);
            // Prefer the nearer strand where two cross, so the front strand reads on top.
            float score = d - depth * 0.0025;
            if (score < best) {
                best = score;
                bestDepth = depth;
            }
            halo += exp(-d * d / (0.0009 + 0.004 * glow)) * (0.6 + 0.4 * depth);
            previous = current;
        }
        float near = clamp(bestDepth * 0.5 + 0.5, 0.0, 1.0);
        float d = max(best + bestDepth * 0.0025, 0.0);
        float core = 1.0 - smoothstep(0.6 * px, 1.8 * px, d);
        vec3 tint = mix(color2, color1, near);
        color += tint * core * mix(0.45, 1.3, near);
        color += tint * exp(-d / (0.003 + 0.012 * glow)) * glow * 0.45 * mix(0.4, 1.0, near);
        color += mix(color2, color1, 0.5) * halo * glow * 0.006;
    }
    fragColor = finish(color);
}
