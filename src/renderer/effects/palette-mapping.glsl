precision highp float;
uniform sampler2D uInput;
uniform sampler2D uOriginal;
uniform vec2 uResolution;
uniform float intensity;
uniform int palette;
varying vec2 vUv;
vec3 ramp(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  if (t < 0.33333333) return mix(a, b, t * 3.0);
  if (t < 0.66666667) return mix(b, c, (t - 0.33333333) * 3.0);
  return mix(c, d, (t - 0.66666667) * 3.0);
}
void main() {
  vec2 size = max(uResolution, vec2(1.0));
  vec2 uv = clamp(vUv, 0.5 / size, 1.0 - 0.5 / size);
  vec3 original = texture2D(uOriginal, uv).rgb;
  float t = clamp(dot(texture2D(uInput, uv).rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  vec3 color;
  if (palette == 1) color = ramp(t, vec3(0.06, 0.015, 0.025), vec3(0.55, 0.07, 0.04), vec3(1.0, 0.45, 0.05), vec3(1.0, 0.95, 0.65));
  else if (palette == 2) color = ramp(t, vec3(0.015, 0.035, 0.12), vec3(0.025, 0.24, 0.48), vec3(0.03, 0.75, 0.72), vec3(0.75, 1.0, 0.92));
  else if (palette == 3) color = vec3(t);
  else color = ramp(t, vec3(0.035, 0.015, 0.12), vec3(0.45, 0.035, 0.72), vec3(0.02, 0.85, 0.8), vec3(1.0, 0.95, 0.45));
  gl_FragColor = vec4(mix(original, color, intensity), 1.0);
}
