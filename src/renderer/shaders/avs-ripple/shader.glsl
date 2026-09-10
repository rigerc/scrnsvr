// Ported from AVS/ripple.glsl; original notices are preserved below.
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

mat2 rotate2D(float r) {
    return mat2(cos(r), sin(r), -sin(r), cos(r));
}

void scrnsvrImportedMain() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * resolution.xy) / resolution.y;
    uv *= 0.6; // increase effective resolution / zoom out
    vec3 col = vec3(0);
    float t = time * 0.15;

    vec2 n = vec2(0);
    vec2 q = vec2(0);
    vec2 p = uv;
    float d = dot(p, p);
    float S = 20.0;
    float a = 0.0;
    mat2 m = rotate2D(4.0);

    for (float j = 0.0; j < 20.0; j++) {
        p *= m;
        n *= m;
        q = p * S + t * 1.0 + sin(t * 4. - d * 6.) * 0.8 + j + n;
        a += dot(cos(q) / S, vec2(0.2));
        n += sin(q);
        S *= 1.2;
    }

    col = vec3(1.3, 2.5, 4) * (a + 0.3) + a + a + a - (d * 0.5);

    gl_FragColor = vec4(col, 1.0);
}

void main() {
  scrnsvrImportedMain();
  vec3 color = (gl_FragColor.rgb - 0.5) * contrast + 0.5;
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(mix(vec3(luminance), color, saturation) * brightness, 1.0);
}
