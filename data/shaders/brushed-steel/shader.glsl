precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float scale;
uniform float grain;
uniform float warp;
uniform float lightAngle;
uniform float streakWidth;
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
const float grain = 0.6;
const float warp = 0.35;
const float lightAngle = 30.0;
const float streakWidth = 1.0;
const float brightness = 1.0;
const float saturation = 1.0;
const vec3 highlightColor = vec3(1.000000, 1.000000, 1.000000);
const vec3 color1 = vec3(0.788235, 0.819608, 0.854902);
const vec3 color2 = vec3(0.529412, 0.580392, 0.650980);
const vec3 background = vec3(0.066667, 0.086275, 0.125490);
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
    vec2 q = p / scale;
    vec2 center = vec2(0.12, -0.04) / scale;
    vec2 d = q - center;
    float r = length(d);
    // Gentle dents tilt the brushing direction, which bends the highlight.
    vec2 dent = vec2(noise(q * 2.3 + 7.1), noise(q * 2.3 - 3.4)) - 0.5;
    vec2 radial = normalize(d + 1e-4) + warp * 0.9 * dent;
    radial = normalize(radial);
    // Brushing grain: rings no finer than about 2.5 pixels, broken up along the angle.
    // Sample along the ring with the direction vector, not the angle, so there is no seam.
    vec2 around = d / max(r, 1e-4);
    float rings = r * scale * uResolution.y / 2.5;
    float fine = noise(vec2(rings + around.x * 3.0, around.y * 3.0 + floor(rings) * 0.37));
    float coarse = noise(vec2(rings / 9.0 + around.x, around.y * 1.5));
    float brushed = mix(0.5, fine * 0.65 + coarse * 0.35, grain);
    // Circular brushing reflects where the radius lines up with the light: a bowtie streak.
    float light = radians(lightAngle) + t * 0.12;
    vec2 key = vec2(cos(light), sin(light));
    vec2 fill = vec2(-key.y, key.x);
    float alignment = abs(dot(radial, key));
    float streak = pow(alignment, 60.0 / (streakWidth * streakWidth)) * (0.55 + 0.9 * brushed);
    float broad = pow(alignment, 4.0 / streakWidth);
    float fillStreak = pow(abs(dot(radial, fill)), 140.0 / (streakWidth * streakWidth)) * 0.25;
    float sheen = 0.5 + 0.5 * dot(normalize(p + vec2(0.0, 0.6)), key);
    vec3 base = mix(background, color1, 0.18 + 0.22 * sheen);
    base *= 0.82 + 0.36 * brushed;
    vec3 color = base + color2 * broad * 0.35 * (0.7 + 0.6 * brushed);
    color += highlightColor * (streak + fillStreak) * 0.7;
    // A slightly darker hub keeps the dial's center readable.
    color *= 0.75 + 0.25 * smoothstep(0.0, 0.05, r * scale);
    fragColor = finish(color);
}
