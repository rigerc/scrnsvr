precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float lineSpacing;
uniform float waveHeight;
uniform float shading;
uniform float swell;
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
const float lineSpacing = 0.012;
const float waveHeight = 0.5;
const float shading = 0.7;
const float swell = 0.5;
const float lineWidth = 1.0;
const float brightness = 1.0;
const float saturation = 1.0;
const vec3 color1 = vec3(0.917647, 0.843137, 0.678431);
const vec3 color2 = vec3(0.423529, 0.623529, 0.768627);
const vec3 background = vec3(0.039216, 0.070588, 0.117647);
#endif

// Match the collection's exposure and color controls; keep black at zero brightness.
vec4 finish(vec3 color) {
    color = 1.0 - exp(-max(color, vec3(0.0)) * brightness);
    float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    color = clamp(color + (dither - 0.5) / 255.0 * min(brightness, 1.0), 0.0, 1.0);
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    return vec4(clamp(mix(vec3(luminance), color, saturation), 0.0, 1.0), 1.0);
}

const float HORIZON = 0.6;

// Wave height in screen units. Swells run roughly parallel to the horizon and roll toward the
// viewer; they are larger in front and foreshortened toward the horizon.
float waves(vec2 p, float t) {
    float near = max(HORIZON - p.y, 0.0);
    float z = 0.35 / (near + 0.04);
    float x = p.x * (z + 3.0);
    float h = sin(z * 2.4 + t * 0.6 + x * 0.9) * 0.5
        + sin(z * 3.9 - x * 1.4 + t * 0.85 + 1.3) * 0.3
        + sin(x * 2.6 - z * 1.1 - t * 0.45 + 4.1) * 0.2;
    return h * waveHeight * (0.004 + 0.11 * near);
}

// Line coordinate: integer values are engraved lines, closer together near the horizon.
float lineField(vec2 p, float t) {
    // Spacing grows from a quarter of Line spacing at the horizon to about three times it in front.
    float near = max(HORIZON - (p.y + waves(p, t)), 0.0);
    return log(0.25 + 4.5 * near) / (4.5 * lineSpacing);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 p = ((fragCoord / uResolution) - 0.5) * vec2(uResolution.x / uResolution.y, 1.0) + vec2(0.0, 0.5);
    float t = uTime * speed * mix(0.3, 1.6, swell / 1.5);
    float px = 1.0 / uResolution.y;
    float minimum = 0.5 * lineWidth * px;
    vec2 sun = vec2(0.18 * uResolution.x / uResolution.y, HORIZON + 0.17);
    vec3 color = background;
    if (p.y < HORIZON) {
        float field = lineField(p, t);
        float gx = lineField(p + vec2(px, 0.0), t) - field;
        float gy = lineField(p + vec2(0.0, px), t) - field;
        float perPixel = max(length(vec2(gx, gy)), 1e-5);
        // Tone: light lines on a dark plate, so wave faces turned toward the sun get thicker lines.
        float slope = (waves(p + vec2(0.0, px), t) - waves(p, t)) / px;
        float near = HORIZON - p.y;
        float glitter = exp(-pow((p.x - sun.x) / (0.05 + 0.5 * near), 2.0));
        float light = clamp(0.45 - slope * 8.0 + glitter * 0.5, 0.0, 1.0);
        float ink = mix(0.28, mix(0.06, 0.5, light), shading);
        float distance = abs(fract(field + 0.5) - 0.5) / perPixel * px;
        float halfWidth = max(ink * 0.5 / perPixel * px, minimum);
        float line = 1.0 - smoothstep(halfWidth - 0.6 * px, halfWidth + 0.6 * px, distance);
        // Lines closer than about three pixels merge into their average tone instead of shimmering.
        float spacing = 1.0 / perPixel;
        line = mix(ink * 0.85, line, smoothstep(2.5, 4.5, spacing));
        vec3 tint = mix(color2, color1, light * 0.6 + glitter * 0.4);
        color += tint * line * mix(0.55, 0.95, smoothstep(0.0, 0.25, near));
    } else {
        // Sky: sparse straight hatching that thickens inside the sun's disc.
        float above = p.y - HORIZON;
        float toSun = length(p - sun);
        float disc = 1.0 - smoothstep(0.072, 0.072 + px, toSun);
        // Inside the sun the hatching is finer, so the disc reads as engraved rather than striped.
        float spacing = mix(lineSpacing * (1.6 + above * 8.0), lineSpacing * 0.55, disc);
        float field = above / spacing;
        float ink = mix(0.08, 0.42, disc);
        float distance = abs(fract(field + 0.5) - 0.5) * spacing;
        float halfWidth = max(ink * 0.5 * spacing, minimum);
        float line = 1.0 - smoothstep(halfWidth - 0.6 * px, halfWidth + 0.6 * px, distance);
        float fade = 1.0 - smoothstep(0.0, 0.32, above);
        color += mix(color2, color1, 0.4 + 0.6 * disc) * line * mix(fade * 0.22, 1.2, disc);
        color += color1 * 0.9 * (1.0 - smoothstep(minimum, minimum + px, abs(toSun - 0.072)));
        color += color1 * 0.05 * exp(-toSun * 9.0);
    }
    // The horizon itself is one firm engraved stroke.
    color += color1 * 0.4 * (1.0 - smoothstep(minimum, minimum + px, abs(p.y - HORIZON)));
    fragColor = finish(color);
}
