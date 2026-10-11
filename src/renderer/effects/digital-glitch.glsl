precision highp float;
uniform sampler2D uInput;
uniform sampler2D uOriginal;
uniform vec2 uResolution;
uniform float uTime;
uniform float intensity;
uniform float frequency;
uniform float displacement;
uniform int blockSize;
uniform float colorSplit;
varying vec2 vUv;
float noise(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 sampleImage(vec2 uv) {
  vec2 edge = 0.5 / max(uResolution, vec2(1.0));
  return texture2D(uInput, clamp(uv, edge, 1.0 - edge)).rgb;
}
void main() {
  vec2 size = max(uResolution, vec2(1.0));
  vec3 original = texture2D(uOriginal, clamp(vUv, 0.5 / size, 1.0 - 0.5 / size)).rgb;
  float band = floor(vUv.y * size.y / max(float(blockSize), 1.0));
  float tick = floor(uTime * 3.0);
  float phase = fract(uTime * 3.0);
  // Smoothly fade a small subset of horizontal bands; never invert or flash the screen.
  float envelope = smoothstep(0.0, 0.15, phase) * (1.0 - smoothstep(0.65, 1.0, phase));
  float active = frequency <= 0.0 ? 0.0 : step(1.0 - frequency * 0.4, noise(vec2(band, tick + 7.0))) * envelope;
  float offset = (noise(vec2(band + 31.0, tick)) - 0.5) * displacement * 0.16 * active;
  vec2 uv = vUv + vec2(offset, 0.0);
  vec2 split = vec2(colorSplit * active * 0.018, 0.0);
  vec3 color = sampleImage(uv);
  color.r = sampleImage(uv + split).r;
  color.b = sampleImage(uv - split).b;
  gl_FragColor = vec4(mix(original, color, intensity), 1.0);
}
