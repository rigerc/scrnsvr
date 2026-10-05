precision highp float;
uniform sampler2D uInput;
uniform vec2 uResolution;
uniform float uTime;
uniform float intensity;
uniform float grain;
uniform float scanlines;
uniform float colorBleed;
uniform float tracking;
varying vec2 vUv;

// Keep every tap inside a texel center: odd sizes and WebGL1 NPOT targets
// behave exactly like larger displays, without wrapping or a dark border.
vec3 tapeSample(vec2 uv) {
  vec2 edge = 0.5 / max(uResolution, vec2(1.0));
  return texture2D(uInput, clamp(uv, edge, 1.0 - edge)).rgb;
}
float noise(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
void main() {
  vec3 original = tapeSample(vUv);
  if (intensity <= 0.0) { gl_FragColor = vec4(original, 1.0); return; }
  vec2 size = max(uResolution, vec2(1.0));
  float frame = floor(uTime * 24.0);
  float row = floor(vUv.y * size.y);
  float bandPosition = fract(uTime * 0.073);
  float bandDistance = abs(vUv.y - bandPosition);
  float band = 1.0 - smoothstep(0.0, 0.035, bandDistance);
  float jitter = (noise(vec2(row, frame)) - 0.5) * 0.8;
  float drift = sin(row * 0.065 + uTime * 4.0) * band * 3.0;
  vec2 uv = vUv + vec2((jitter + drift) * tracking / size.x, 0.0);
  vec2 bleed = vec2((0.5 + band * 1.5) * colorBleed * 2.0 / size.x, 0.0);
  vec3 tape = tapeSample(uv);
  tape.r = tapeSample(uv + bleed).r;
  tape.b = tapeSample(uv - bleed).b;
  float lines = mod(row, 2.0);
  tape *= 1.0 - scanlines * 0.10 * lines;
  tape += (noise(floor(vUv * size) + vec2(frame * 13.0, frame * 7.0)) - 0.5) * grain * 0.10;
  tape += band * tracking * 0.025;
  gl_FragColor = vec4(mix(original, clamp(tape, 0.0, 1.0), intensity), 1.0);
}
