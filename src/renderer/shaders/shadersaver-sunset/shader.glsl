// Ported from ShaderSaver/shader2.txt; original notices are preserved below.
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
    "Sunset" by @XorDev

    Based on my tweet shader:
    https://x.com/XorDev/status/1918764164153049480
*/
void mainImage(out vec4 O, vec2 I) {
  float t = iTime;
  float z = 0.0;
  O = vec4(0.0);
  for (int step = 0; step < 100; ++step) {
    vec3 p = z * normalize(vec3(I + I, 0.0) - iResolution.xyy);
    float frequency = 5.0;
    for (int octave = 0; octave < 6; ++octave) {
      p += 0.6 * sin(p.yzx * frequency - 0.2 * t) / frequency;
      frequency += frequency;
    }
    float s = 0.3 - abs(p.y);
    float d = 0.005 + max(s, -s * 0.2) / 4.0;
    z += d;
    O += (cos(s / 0.07 + p.x + 0.5 * t - vec4(3,4,5,0)) + 1.5) * exp(s / 0.1) / d;
  }
  O = scrnsvrTanh(O * O / 4e8);
}

void main() {
  vec4 importedColor = vec4(0.0);
  mainImage(importedColor, gl_FragCoord.xy);
  gl_FragColor = importedColor;
  vec3 color = (gl_FragColor.rgb - 0.5) * contrast + 0.5;
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(mix(vec3(luminance), color, saturation) * brightness, 1.0);
}
