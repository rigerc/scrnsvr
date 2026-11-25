precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform int ridgeCount;
uniform float peakHeight;
uniform float roughness;
uniform float drift;
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
const int ridgeCount = 28;
const float peakHeight = 0.5;
const float roughness = 0.5;
const float drift = 0.4;
const float lineWidth = 1.0;
const float brightness = 1.0;
const float saturation = 1.0;
const vec3 color1 = vec3(0.945098, 0.894118, 0.796078);
const vec3 color2 = vec3(0.364706, 0.486275, 0.650980);
const vec3 background = vec3(0.039216, 0.054902, 0.086275);
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
    return fract(sin(n * 78.233) * 43758.5453);
}

// Value noise with its derivative, so each ridge's slope is exact without derivatives.
vec2 noiseD(float x) {
    float i = floor(x);
    float f = fract(x);
    float a = hash(i);
    float b = hash(i + 1.0);
    float u = f * f * (3.0 - 2.0 * f);
    return vec2(mix(a, b, u), (b - a) * 6.0 * f * (1.0 - f));
}

// Ridge profile (height, slope): ridged peaks plus finer jagged detail.
vec2 profile(float x, float seed) {
    vec2 sum = vec2(0.0);
    float amplitude = 1.0;
    float frequency = 1.0;
    for (int o = 0; o < 4; o++) {
        vec2 n = noiseD(x * frequency + seed * 17.0 + float(o) * 31.7);
        float sign = n.x > 0.5 ? 1.0 : -1.0;
        float ridge = 1.0 - abs(n.x * 2.0 - 1.0);
        float weight = o == 0 ? 1.0 : roughness;
        // d/dx of (1 - |2n - 1|)^2 = -2 * ridge * 2 * sign * n'
        sum += weight * amplitude * vec2(ridge * ridge, -4.0 * ridge * sign * n.y * frequency);
        amplitude *= 0.45;
        frequency *= 2.3;
    }
    return sum;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / uResolution;
    float aspect = uResolution.x / uResolution.y;
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y);
    float t = uTime * speed;
    float px = 1.0 / uResolution.y;
    float halfWidth = 0.5 * lineWidth * px;
    float count = float(ridgeCount);
    vec3 color = background + color2 * 0.06 * exp(-abs(uv.y - 0.72) * 9.0);
    // The farthest ridge sits highest; nothing above its tallest possible peak needs the loop.
    float ceiling = 0.74 + peakHeight * 0.06 + 0.02;
    if (p.y < ceiling) {
        // Walk from the nearest ridge back. A ridge that covers the pixel hides every ridge behind it.
        for (int k = 0; k < 48; k++) {
            if (k >= ridgeCount) break;
            float i = count - 1.0 - float(k);
            float z = i / max(count - 1.0, 1.0);
            float base = mix(0.7, 0.06, pow(z, 1.25));
            float amplitude = peakHeight * mix(0.06, 0.32, z * z);
            float scale = mix(4.2, 0.8, z);
            float x = p.x * scale + t * drift * mix(0.05, 0.35, z) + i * 13.1;
            vec2 h = profile(x, i);
            float top = base + amplitude * h.x;
            float slope = amplitude * h.y * scale;
            float distance = abs(p.y - top) / sqrt(1.0 + slope * slope);
            float line = 1.0 - smoothstep(halfWidth, halfWidth + 1.1 * px, distance);
            vec3 tint = mix(color2, color1, smoothstep(0.0, 1.0, z));
            color += tint * line * mix(0.35, 1.0, z);
            if (p.y < top) {
                // Under a ridge: a faint wash of the ridge's own color fills the slope, then stop.
                color += tint * 0.025 * mix(0.4, 1.0, z) * smoothstep(0.12, 0.0, top - p.y);
                break;
            }
        }
    }
    fragColor = finish(color);
}
