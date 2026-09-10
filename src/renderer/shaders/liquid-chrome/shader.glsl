precision highp float;

uniform float uTime;
uniform vec2 uResolution;
varying vec2 vUv;
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

// Square explicitly: pow() is undefined for negative bases in GLSL.
float square(float x) { return x * x; }

// Match the collection's exposure and color controls; keep black at zero brightness.
void finish(vec3 color) {
    color = 1.0 - exp(-max(color, vec3(0.0)) * brightness);
    float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    color = clamp(color + (dither - 0.5) / 255.0 * min(brightness, 1.0), 0.0, 1.0);
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor = vec4(clamp(mix(vec3(luminance), color, saturation), 0.0, 1.0), 1.0);
}

void main() {
    vec2 p = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
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
    float strip = exp(-square((axis - 0.25) / (0.03 + roughness * 0.2)));
    vec3 tint = mix(color1, color2, 0.5 + 0.5 * reflected.y);
    vec3 color = mix(background, tint, 0.12 + 0.85 * light) + strip * 0.55;
    color *= 0.8 + 0.2 * normal.z;
    finish(color);
}
