// Ported from AVS/fractal.glsl; original notices are preserved below.
precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float contrast;
uniform float brightness;
uniform float saturation;
#define time (uTime * speed)
#define resolution (uResolution)

float scrnsvrTanh(float value) { float e = exp(clamp(2.0 * value, -40.0, 40.0)); return (e - 1.0) / (e + 1.0); }
vec2 scrnsvrTanh(vec2 value) { return vec2(scrnsvrTanh(value.x), scrnsvrTanh(value.y)); }
vec3 scrnsvrTanh(vec3 value) { return vec3(scrnsvrTanh(value.x), scrnsvrTanh(value.y), scrnsvrTanh(value.z)); }
vec4 scrnsvrTanh(vec4 value) { return vec4(scrnsvrTanh(value.x), scrnsvrTanh(value.y), scrnsvrTanh(value.z), scrnsvrTanh(value.w)); }

// twigl.app shader (geeker 300es)
// Converted to standalone GLSL for use with temiz.cpp host


mat2 rotate2D(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
}

vec3 hsv(float h, float s, float v) {
    return ((clamp(abs(fract(h + vec3(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0) - 1.0) * s + 1.0) * v;
}

#define R rotate2D

void scrnsvrImportedMain() {
    vec4 o = vec4(0.0);
    float t = time;
    vec2 r = resolution;
    vec4 FC = gl_FragCoord;

    vec2 p = FC.xy, q = vec2(0.0), l = (p + p - r) / r.x * 0.4 + vec2(-0.25, 0.05), n = vec2(0.0);
    float s = 6.0, h = 0.0, L = dot(l + 1.8, l);
    for (int iteration = 0; iteration < 129; iteration++) {
        float i = float(iteration + 1);
        l *= R(4.96);
        n *= R(4.8 + sin(t) * 0.05) + rotate2D(t) * 0.035;
        q = l * s * i + n;
        h += dot(r / r, sin(q) / s * 4.0);
        n += cos(q);
        s *= 1.05;
    }
    h = 0.4 - h * 0.26 - L;
    o.rgb += 0.5 * h - hsv(0.1, h * 0.5, 0.3);

    gl_FragColor = o;
}

void main() {
  scrnsvrImportedMain();
  vec3 color = (gl_FragColor.rgb - 0.5) * contrast + 0.5;
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(mix(vec3(luminance), color, saturation) * brightness, 1.0);
}
