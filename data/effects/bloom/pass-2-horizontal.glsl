precision highp float;
uniform sampler2D uInput;
uniform vec2 uResolution;
uniform float radius;
varying vec2 vUv;
void main() {
  vec2 size = max(uResolution, vec2(1.0));
  vec2 edge = 0.5 / size;
  vec3 sum = vec3(0.0);
  float weights = 0.0;
  // Static ES 1.00 loop, Gaussian sigma = one third of the finite support.
  for (int i = -8; i <= 8; i++) {
    float tap = float(i);
    float weight = exp(-tap * tap / 14.222222);
    vec2 uv = vUv + vec2(tap * radius / 8.0 / size.x, 0.0);
    sum += texture2D(uInput, clamp(uv, edge, 1.0 - edge)).rgb * weight;
    weights += weight;
  }
  gl_FragColor = vec4(sum / weights, 1.0);
}
