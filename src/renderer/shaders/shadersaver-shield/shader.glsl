// Ported from ShaderSaver/shader5.txt; original notices are preserved below.
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
    "Shield" by @XorDev

    Inspired by @cmzw's work: witter.com/cmzw_/status/1729148918225916406

    X: X.com/XorDev/status/1730436700000649470
    Twigl: twigl.app/?ol=true&ss=-NkYXGfK5wEl4VaUQ9zS
*/
void mainImage(out vec4 O, vec2 I) {
  float t = iTime * 0.91;
  O = vec4(0.0);
  for (int step = 0; step < 100; ++step) {
    float i = float(step) * 0.01;
    vec2 v = iResolution.xy;
    vec2 p = (I + I - v) / v.y * i;
    float z = max(1.0 - dot(p, p), 0.0);
    p /= 0.2 + sqrt(z) * 0.3;
    p.y += fract(ceil(p.x = p.x / 0.9 + t) * 0.5) + t * 0.2;
    v = abs(fract(p) - 0.5);
    O += vec4(2,3,5,1) / 2e3 * z / (abs(max(v.x * 1.5 + v, v + v).y - 1.0) + 0.1 - i * 0.09);
  }
  O = scrnsvrTanh(O * O);
}

void main() {
  vec4 importedColor = vec4(0.0);
  mainImage(importedColor, gl_FragCoord.xy);
  gl_FragColor = importedColor;
  vec3 color = (gl_FragColor.rgb - 0.5) * contrast + 0.5;
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(mix(vec3(luminance), color, saturation) * brightness, 1.0);
}
