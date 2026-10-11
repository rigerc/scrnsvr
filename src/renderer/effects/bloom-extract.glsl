precision highp float;
uniform sampler2D uInput;
uniform vec2 uResolution;
uniform float threshold;
varying vec2 vUv;
void main() {
  vec2 edge = 0.5 / max(uResolution, vec2(1.0));
  vec3 color = texture2D(uInput, clamp(vUv, edge, 1.0 - edge)).rgb;
  float brightness = max(color.r, max(color.g, color.b));
  float contribution = max(brightness - threshold, 0.0) / max(1.0 - threshold, 0.001);
  gl_FragColor = vec4(color * contribution, 1.0);
}
