precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform int jellyCount;
uniform float bellSize;
uniform float tentacleLength;
uniform float pulseRate;
uniform float brightness;
uniform float saturation;
uniform vec3 color1;
uniform vec3 color2;
uniform vec3 background;
#else
#define uTime iTime
#define uResolution iResolution.xy
const float speed = 0.3;
const int jellyCount = 4;
const float bellSize = 0.09;
const float tentacleLength = 0.6;
const float pulseRate = 0.6;
const float brightness = 1.0;
const float saturation = 1.0;
const vec3 color1 = vec3(0.623529, 0.847059, 1.000000);
const vec3 color2 = vec3(0.811765, 0.572549, 1.000000);
const vec3 background = vec3(0.015686, 0.031373, 0.090196);
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
    return fract(sin(n * 91.3458) * 47453.5453);
}

float glowLine(float distance, float width) {
    float x = distance / width;
    return exp(-x * x);
}

// Approximate distance to an ellipse with the given semi-axes (first-order, exact on the curve).
float ellipseDistance(vec2 q, vec2 axes) {
    vec2 m = q / axes;
    float k = length(m);
    vec2 gradient = m / (axes * max(k, 1e-4));
    return abs(k - 1.0) / max(length(gradient), 1e-4);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / uResolution;
    float aspect = uResolution.x / uResolution.y;
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y);
    float t = uTime * speed;
    float px = 1.0 / uResolution.y;
    vec3 color = background + color2 * 0.04 * uv.y;
    float count = float(jellyCount);
    for (int j = 0; j < 6; j++) {
        if (j >= jellyCount) break;
        float fj = float(j);
        float seed = hash(fj + 1.3);
        // Nearer jellyfish are larger and brighter.
        float depth = mix(0.55, 1.0, hash(fj + 7.1));
        float radius = bellSize * depth;
        float trail = tentacleLength * radius * 8.0;
        float phase = t * pulseRate * 2.2 + seed * 6.2831853;
        float contraction = pow(0.5 + 0.5 * sin(phase), 2.0);
        // Each contraction pushes the bell upward, so the rise surges with the pulse.
        // All rise at one pace from evenly staggered heights, so the frame is never empty.
        float rise = 0.03 * (t + 0.35 * sin(phase - 1.2) / max(pulseRate * 2.2, 0.1));
        float longest = bellSize * (2.0 + tentacleLength * 8.0);
        float span = 1.0 + longest;
        float y = mod((fj + 0.4 * hash(fj + 3.7)) / count * span + rise, span) - bellSize * tentacleLength * 8.0 - bellSize * 0.5;
        float lane = fract(fj * 0.618034 + 0.31) - 0.5;
        float x = lane * aspect * 0.8 + (seed - 0.5) * 0.08 + 0.06 * sin(t * 0.05 + fj * 2.1);
        vec2 q = p - vec2(x, y);
        float tilt = 0.18 * sin(t * 0.11 + fj * 1.9);
        q = mat2(cos(tilt), -sin(tilt), sin(tilt), cos(tilt)) * q;
        float width = radius * (1.0 - 0.2 * contraction);
        float height = radius * (0.72 + 0.2 * contraction);
        if (abs(q.x) > width * 2.4 || q.y > height * 1.6 || q.y < -trail - radius) continue;
        vec3 rimColor = color1 * depth;
        // Bell: a glowing dome edge with a faint translucent interior.
        vec2 e = q / vec2(width, height);
        float dome = length(e);
        float upper = smoothstep(-0.25, 0.05, e.y);
        color += rimColor * glowLine(ellipseDistance(q, vec2(width, height)), px * 1.4 + radius * 0.035) * upper * 0.9;
        color += rimColor * smoothstep(1.0, 0.2, dome) * upper * 0.12;
        color += mix(color1, color2, 0.5) * depth * exp(-dot(e - vec2(0.0, 0.25), e - vec2(0.0, 0.25)) * 7.0) * upper * 0.08;
        // The bell margin: a bright, slightly flared opening.
        vec2 lip = q + vec2(0.0, height * 0.08);
        vec2 lipAxes = vec2(width * (1.0 + 0.08 * contraction), height * 0.16);
        color += rimColor * glowLine(ellipseDistance(lip, lipAxes), px * 1.2 + radius * 0.012) * step(lip.y, 0.0) * 0.8;
        // Tendrils hang from the margin and sway with a wave that travels down them.
        float top = -height * 0.1;
        float along = (top - q.y) / trail;
        if (along > 0.0 && along < 1.0) {
            for (int k = 0; k < 7; k++) {
                float fk = float(k);
                float anchor = (fk / 6.0 * 2.0 - 1.0) * width * 0.85;
                float sway = radius * (0.25 + 0.5 * along) * along * sin(along * 7.0 - t * 1.6 + fk * 1.3 + seed * 5.0);
                float lean = along * along * radius * 0.6 * sin(t * 0.09 + fj);
                float dx = q.x - (anchor * (1.0 - 0.45 * along) + sway + lean);
                float fade = pow(1.0 - along, 1.6);
                color += color2 * depth * glowLine(dx, px * 1.1 + radius * 0.012) * fade * 0.7;
            }
            // Two thicker oral arms ripple down the center.
            for (int k = 0; k < 2; k++) {
                float fk = float(k) * 2.0 - 1.0;
                float reach = along * 1.6;
                if (reach > 1.0) continue;
                float arm = fk * width * 0.12 + radius * 0.22 * reach * sin(reach * 9.0 - t * 1.2 + fk * 2.0);
                float fade = pow(1.0 - reach, 1.2);
                color += mix(color1, color2, 0.4) * depth * glowLine(q.x - arm, px * 1.5 + radius * 0.05 * (1.0 - reach)) * fade * 0.45;
            }
        }
    }
    fragColor = finish(color);
}
