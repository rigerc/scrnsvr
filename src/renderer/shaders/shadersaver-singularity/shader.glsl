// Ported from ShaderSaver/shader.txt; original notices are preserved below.
precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float contrast;
uniform float brightness;
uniform float saturation;
#define iTime (uTime * speed)
#define iResolution (vec3(uResolution, 1.0))

float scrnsvrTanh(float value) { float e = exp(clamp(2.0 * value, -40.0, 40.0)); return (e - 1.0) / (e + 1.0); }
vec2 scrnsvrTanh(vec2 value) { return vec2(scrnsvrTanh(value.x), scrnsvrTanh(value.y)); }
vec3 scrnsvrTanh(vec3 value) { return vec3(scrnsvrTanh(value.x), scrnsvrTanh(value.y), scrnsvrTanh(value.z)); }
vec4 scrnsvrTanh(vec4 value) { return vec4(scrnsvrTanh(value.x), scrnsvrTanh(value.y), scrnsvrTanh(value.z), scrnsvrTanh(value.w)); }

/*
    "Singularity" by @XorDev

    A whirling blackhole.
    Feel free to code golf!

    FabriceNeyret2: -19
    dean_the_coder: -12
    iq: -4
*/
void mainImage(out vec4 O, vec2 F) {
  float i = 0.2;
  vec2 r = iResolution.xy;
  vec2 p = (F + F - r) / r.y / 0.7;
  vec2 d = vec2(-1.0, 1.0);
  vec2 b = p - i * d;
  vec2 c = p * mat2(1.0, 1.0, d / (0.1 + i / dot(b, b)));
  float a = dot(c, c);
  vec2 v = c * mat2(cos(0.5 * log(a) + iTime * i + vec4(0, 33, 11, 0))) / i;
  vec2 w = vec2(0.0);
  for (int wave = 0; wave < 9; ++wave) {
    i += 1.0;
    v += 0.7 * sin(v.yx * i + iTime) / i + 0.5;
    w += 1.0 + sin(v);
  }
  i = length(sin(v / 0.3) * 0.4 + c * (3.0 + d));
  O = 1.0 - exp(-exp(c.x * vec4(0.6, -0.4, -1.0, 0.0)) / w.xyyx
    / (2.0 + i*i/4.0 - i) / (0.5 + 1.0/a) / (0.03 + abs(length(p) - 0.7)));
}

void main() {
  vec4 importedColor = vec4(0.0);
  mainImage(importedColor, gl_FragCoord.xy);
  gl_FragColor = importedColor;
  vec3 color = (gl_FragColor.rgb - 0.5) * contrast + 0.5;
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(mix(vec3(luminance), color, saturation) * brightness, 1.0);
}
