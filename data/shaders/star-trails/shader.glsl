precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float density;
uniform float trailLength;
uniform float poleOffset;
uniform float twinkle;
uniform float brightness;
uniform float saturation;
uniform vec3 color1;
uniform vec3 color2;
uniform vec3 background;
#else
#define uTime iTime
#define uResolution iResolution.xy
const float speed = 0.3;
const float density = 0.6;
const float trailLength = 0.55;
const float poleOffset = 0.6;
const float twinkle = 0.4;
const float brightness = 1.0;
const float saturation = 1.0;
const vec3 color1 = vec3(0.811765, 0.878431, 1.000000);
const vec3 color2 = vec3(1.000000, 0.788235, 0.541176);
const vec3 background = vec3(0.019608, 0.039216, 0.086275);
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
    return fract(sin(n * 12.9898) * 43758.5453);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / uResolution;
    vec2 p = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
    float t = uTime * speed;
    float px = 1.0 / uResolution.y;
    // The pole drifts from the frame center toward the upper right as the offset grows.
    vec2 pole = mix(vec2(0.0, 0.05), vec2(0.62, 0.58), poleOffset);
    vec2 d = p - pole;
    float r = length(d);
    // The sky turns as one: every trail shares the rotation, so the arcs never cross.
    float angle = atan(d.y, d.x) + 3.14159265 - t * 0.035;
    float rings = 110.0 + 60.0 * density;
    float sector = 6.2831853 / 3.0;
    float arc = min(trailLength, sector * 0.9);
    vec3 color = background + mix(color2, color1, uv.y) * 0.05 * (1.0 - uv.y) * (1.0 - uv.y);
    float ringIndex = floor(r * rings);
    for (int k = -1; k <= 1; k++) {
        float ring = ringIndex + float(k);
        if (ring < 1.0) continue;
        for (int s = 0; s < 3; s++) {
            float id = ring * 3.0 + float(s);
            float present = step(hash(id + 0.37), 0.25 + 0.6 * density);
            if (present < 0.5) continue;
            float start = float(s) * sector + hash(id + 1.91) * (sector - arc);
            float along = mod(angle - start, 6.2831853);
            if (along > arc + 0.05) continue;
            float magnitude = pow(hash(id + 4.13), 3.0);
            float radius = (ring + 0.5 + (hash(id + 2.71) - 0.5) * 0.6) / rings;
            float width = px * (0.55 + 0.9 * magnitude);
            float across = (r - radius) / width;
            float line = exp(-across * across);
            // The head (latest position) is brightest; the oldest end fades out softly.
            float head = clamp(along / max(arc, 0.001), 0.0, 1.0);
            float body = smoothstep(0.0, 0.18, head) * (1.0 - smoothstep(arc, arc + 0.02, along));
            float flicker = 1.0 - twinkle * 0.45 * (0.5 + 0.5 * sin(along * radius * 140.0 - t * 1.7 + id));
            vec3 tint = mix(color1, color2, smoothstep(0.35, 1.0, hash(id + 6.07)));
            float energy = (0.35 + 1.4 * magnitude) * mix(0.45, 1.0, head);
            color += tint * line * body * flicker * energy;
        }
    }
    // Rings near the pole are only a few pixels around; let them dissolve into a faint glow.
    color = mix(background + color1 * 0.08 * exp(-r * r * 900.0), color, smoothstep(0.015, 0.06, r));
    fragColor = finish(color);
}
