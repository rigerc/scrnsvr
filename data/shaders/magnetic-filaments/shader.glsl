precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform int poleCount;
uniform float poleSpacing;
uniform float lineDensity;
uniform float curvature;
uniform float brightness;
uniform float saturation;
uniform vec3 color1;
uniform vec3 color2;
uniform vec3 background;
#else
#define uTime iTime
#define uResolution iResolution.xy
const float speed = 0.3;
const int poleCount = 4;
const float poleSpacing = 0.32;
const float lineDensity = 16.0;
const float curvature = 0.65;
const float brightness = 1.0;
const float saturation = 1.0;
const vec3 color1 = vec3(0.407843, 0.827451, 0.839216);
const vec3 color2 = vec3(0.725490, 0.572549, 0.956863);
const vec3 background = vec3(0.035294, 0.058824, 0.125490);
#endif

// Match the collection's exposure and color controls; keep black at zero brightness.
vec4 finish(vec3 color) {
    color = 1.0 - exp(-max(color, vec3(0.0)) * brightness);
    float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    color = clamp(color + (dither - 0.5) / 255.0 * min(brightness, 1.0), 0.0, 1.0);
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    return vec4(clamp(mix(vec3(luminance), color, saturation), 0.0, 1.0), 1.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 p = ((fragCoord / uResolution) - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
    float t = uTime * speed;
    float field = 0.0;
    vec2 gradient = vec2(0.0);
    float cores = 0.0;
    for (int i = 0; i < 6; i++) {
        if (i >= poleCount) continue;
        float fi = float(i);
        float angle = fi * 6.2831853 / float(poleCount) + t * 0.13;
        vec2 center = poleSpacing * vec2(cos(angle), sin(angle));
        center += curvature * 0.035 * vec2(sin(t * 0.3 + fi * 2.0), cos(t * 0.23 + fi));
        vec2 delta = p - center;
        float charge = mod(fi, 2.0) * 2.0 - 1.0;
        float d2 = dot(delta, delta) + 0.003;
        field += charge * log(d2) * 0.35;
        gradient += charge * 0.7 * delta / d2;
        cores += exp(-dot(delta, delta) / 0.00035);
    }
    field += curvature * 0.15 * sin(p.x * 3.0 + t * 0.2);
    gradient.x += curvature * 0.45 * cos(p.x * 3.0 + t * 0.2);
    float phase = field * lineDensity;
    float aa = clamp(length(gradient) * lineDensity * 1.5 / uResolution.y, 0.008, 0.45);
    float d = abs(fract(phase) - 0.5);
    float line = 1.0 - smoothstep(0.015, 0.015 + aa, d);
    // Fade subpixel contours near pole centers rather than letting them shimmer.
    line *= 1.0 - smoothstep(0.2, 0.45, aa);
    float pulse = 0.65 + 0.35 * sin(field * 3.0 - t * 0.8);
    vec3 tint = mix(color1, color2, 0.5 + 0.5 * sin(field * 2.0 + t * 0.15));
    vec3 color = background + tint * line * pulse + mix(color1, color2, 0.5) * cores * 0.9;
    fragColor = finish(color);
}
