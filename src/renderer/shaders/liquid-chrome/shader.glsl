precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float reflectionWidth;
uniform float reflectionStrength;
uniform vec3 highlightColor;
uniform float speed;
uniform float scale;
uniform float roughness;
uniform float distortion;
uniform float lightAngle;
uniform float brightness;
uniform float saturation;
uniform vec3 color1;
uniform vec3 color2;
uniform vec3 background;
#else
#define uTime iTime
#define uResolution iResolution.xy
const float reflectionWidth = 1.0;
const float reflectionStrength = 1.0;
const vec3 highlightColor = vec3(1.000000, 1.000000, 1.000000);
const float speed = 0.3;
const float scale = 2.0;
const float roughness = 0.25;
const float distortion = 0.6;
const float lightAngle = 25.0;
const float brightness = 1.0;
const float saturation = 1.0;
const vec3 color1 = vec3(0.815686, 0.862745, 0.905882);
const vec3 color2 = vec3(0.611765, 0.686275, 0.831373);
const vec3 background = vec3(0.062745, 0.086275, 0.141176);
#endif

// Square explicitly: pow() is undefined for negative bases in GLSL.
float square(float x) { return x * x; }

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
    vec2 q = p * scale;
    float t = uTime * speed;
    // Analytic derivatives of three traveling waves define a smooth normal.
    float a = q.x * 2.3 + q.y * 1.1 + t * 0.38;
    float b = q.y * 3.1 - q.x * 0.8 - t * 0.27;
    float c = (q.x + q.y) * 4.2 + t * 0.19;
    vec2 slope = vec2(2.3, 1.1) * cos(a) * 0.3
        + vec2(-0.8, 3.1) * cos(b) * 0.2
        + vec2(4.2) * cos(c) * distortion * 0.13;
    vec3 normal = normalize(vec3(-slope, 1.0));
    vec3 reflected = reflect(vec3(0.0, 0.0, -1.0), normal);
    float angle = radians(lightAngle);
    float axis = dot(reflected.xy, vec2(cos(angle), sin(angle)));
    float band = 0.5 + 0.5 * sin(axis * 7.0 + reflected.z * 2.0);
    float light = smoothstep(0.5 - roughness * 0.4, 0.55 + roughness * 0.4, band);
    float strip = exp(-square((axis - 0.25) / ((0.03 + roughness * 0.2) * reflectionWidth)));
    vec3 tint = mix(color1, color2, 0.5 + 0.5 * reflected.y);
    vec3 color = mix(background, tint, 0.12 + 0.85 * light) + highlightColor * strip * 0.55 * reflectionStrength;
    color *= 0.8 + 0.2 * normal.z;
    fragColor = finish(color);
}
