precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float scale;
uniform float figure;
uniform float grain;
uniform float chatoyance;
uniform float lightOrbit;
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
const float figure = 0.5;
const float grain = 0.6;
const float chatoyance = 0.6;
const float lightOrbit = 0.5;
const float brightness = 1.0;
const float saturation = 1.0;
const vec3 highlightColor = vec3(1.000000, 0.909804, 0.760784);
const vec3 color1 = vec3(0.788235, 0.541176, 0.294118);
const vec3 color2 = vec3(0.360784, 0.184314, 0.090196);
const vec3 background = vec3(0.101961, 0.047059, 0.023529);
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

vec2 gradientAt(vec2 i) {
    float angle = hash(i) * 6.2831853;
    return vec2(cos(angle), sin(angle));
}

// Gradient noise in 0..1. Lighting reads its slope, and value noise's slope collapses
// along every lattice line, which would show as faint straight seams.
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float a = dot(gradientAt(i), f);
    float b = dot(gradientAt(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
    float c = dot(gradientAt(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
    float d = dot(gradientAt(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
    return clamp(0.5 + 0.75 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y), 0.0, 1.0);
}

float fbm(vec2 p) {
    float sum = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 3; i++) {
        sum += amplitude * noise(p);
        p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.3;
        amplitude *= 0.5;
    }
    return sum;
}

// Growth field: rings of wood pulled into swirls around burl eyes. Integer steps are growth rings.
float growth(vec2 q, out float eye) {
    vec2 warp = vec2(fbm(q * 0.9 + 1.7), fbm(q * 0.9 - 4.2)) - 0.5;
    vec2 w = q + warp * 1.8;
    float field = w.y * 1.2 + fbm(w * 1.1) * 2.2;
    vec2 cells = q * 1.4;
    vec2 base = floor(cells);
    eye = 0.0;
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 id = base + vec2(float(i), float(j));
            if (hash(id + 0.5) > figure * 0.9 + 0.05) continue;
            vec2 center = id + 0.3 + 0.4 * vec2(hash(id + 1.3), hash(id + 2.9));
            // Each eye's pull fades to nothing before the 3x3 search could lose it, so there are no seams.
            float d = length(cells - center);
            float reach = 1.0 - smoothstep(0.25, 0.7, d);
            field += (0.6 + figure) * 0.5 * log(d + 0.08) * reach - (0.6 + figure) * 0.5 * log(0.78) * reach;
            eye = max(eye, exp(-d * d / 0.006));
        }
    }
    return field;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 p = ((fragCoord / uResolution) - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
    float t = uTime * speed;
    vec2 q = p * 2.2 / scale + vec2(t * 0.004, 0.0);
    float eye;
    float field = growth(q, eye);
    float e = 0.025;
    float unused;
    vec2 gradient = vec2(growth(q + vec2(e, 0.0), unused) - field, growth(q + vec2(0.0, e), unused) - field) / e;
    vec2 fiber = normalize(vec2(-gradient.y, gradient.x) + 1e-5);
    // Soft, wide grain bands, with faint fibers running along them; no hairline contours.
    float band = 0.5 + 0.5 * sin(field * 6.2831853 * 1.1);
    float fibers = noise(vec2(field * 34.0, q.x * 0.7 + q.y * 0.7));
    float figureTone = fbm(q * 2.5 + field * 0.4);
    float darkness = clamp(0.5 * smoothstep(0.15, 0.95, band) + 0.3 * figureTone + 0.25 * fibers, 0.0, 1.0) * grain;
    vec3 wood = mix(color1, color2, darkness);
    wood = mix(wood, mix(color2, background, 0.6), eye * 0.85);
    // Chatoyance: fibers aligned with the light shine. As the light turns the bright patches trade places.
    float light = t * lightOrbit * 0.12 + 0.6;
    vec2 toLight = vec2(cos(light), sin(light));
    float aligned = abs(dot(fiber, toLight));
    float shimmer = aligned * aligned * aligned * chatoyance;
    vec3 color = wood * (0.5 + 0.2 * (1.0 - chatoyance) + 0.75 * shimmer);
    color = mix(background, color, 0.9);
    // A soft varnish reflection drifts across the polished surface.
    float across = dot(p, normalize(vec2(0.9, 0.45))) - 0.3 * sin(t * 0.045 + 1.3);
    color += highlightColor * exp(-across * across / 0.02) * 0.07;
    fragColor = finish(color);
}
