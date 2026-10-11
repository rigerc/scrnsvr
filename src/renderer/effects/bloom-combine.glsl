precision highp float;
uniform sampler2D uInput;
uniform sampler2D uOriginal;
uniform vec2 uResolution;
uniform float intensity;
uniform float strength;
varying vec2 vUv;
void main() {
  vec2 edge = 0.5 / max(uResolution, vec2(1.0));
  vec2 uv = clamp(vUv, edge, 1.0 - edge);
  vec3 original = texture2D(uOriginal, uv).rgb;
  vec3 glow = texture2D(uInput, uv).rgb;
  vec3 bloomed = clamp(original + glow * strength, 0.0, 1.0);
  gl_FragColor = vec4(mix(original, bloomed, intensity), 1.0);
}
