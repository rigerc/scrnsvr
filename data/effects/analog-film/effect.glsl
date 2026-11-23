precision highp float;
uniform sampler2D uInput;
uniform sampler2D uOriginal;
uniform vec2 uResolution;
uniform float uTime;
uniform float intensity;
uniform float grain;
uniform float warmth;
uniform float fade;
uniform float exposureDrift;
varying vec2 vUv;
float noise(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 size = max(uResolution, vec2(1.0));
  vec2 uv = clamp(vUv, 0.5 / size, 1.0 - 0.5 / size);
  vec3 original = texture2D(uOriginal, uv).rgb;
  vec3 color = texture2D(uInput, uv).rgb;
  color *= vec3(1.0 + warmth * 0.18, 1.0 + warmth * 0.025, 1.0 - warmth * 0.18);
  color += fade * 0.22 * (1.0 - color);
  // Slow exposure modulation is bounded to ten percent, never a flash.
  color *= 1.0 + exposureDrift * (0.065 * sin(uTime * 0.43 + 0.6) + 0.035 * sin(uTime * 0.19));
  float frame = floor(uTime * 24.0);
  color += (noise(floor(vUv * size) + vec2(frame * 17.0, frame * 31.0)) - 0.5) * grain * 0.16;
  gl_FragColor = vec4(mix(original, clamp(color, 0.0, 1.0), intensity), 1.0);
}
