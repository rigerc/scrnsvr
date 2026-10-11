precision highp float;
uniform sampler2D uInput;
uniform sampler2D uOriginal;
uniform vec2 uResolution;
uniform float intensity;
uniform int patternSize;
uniform int levels;
uniform float strength;
varying vec2 vUv;
// Recursively constructed 4x4 Bayer matrix, with no dynamic array indexing.
float bayer2(vec2 p) {
  if (p.y < 1.0) return p.x < 1.0 ? 0.0 : 2.0;
  return p.x < 1.0 ? 3.0 : 1.0;
}
void main() {
  vec2 size = max(uResolution, vec2(1.0));
  vec2 uv = clamp(vUv, 0.5 / size, 1.0 - 0.5 / size);
  vec3 original = texture2D(uOriginal, uv).rgb;
  vec3 color = texture2D(uInput, uv).rgb;
  vec2 cell = mod(floor(vUv * size / max(float(patternSize), 1.0)), 4.0);
  float threshold = (4.0 * bayer2(mod(cell, 2.0)) + bayer2(floor(cell / 2.0)) + 0.5) / 16.0 - 0.5;
  float steps = max(float(levels) - 1.0, 1.0);
  color = floor(clamp(color + strength * threshold / steps, 0.0, 1.0) * steps + 0.5) / steps;
  gl_FragColor = vec4(mix(original, color, intensity), 1.0);
}
