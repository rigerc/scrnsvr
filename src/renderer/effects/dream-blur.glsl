precision highp float;
uniform sampler2D uInput;
uniform sampler2D uOriginal;
uniform vec2 uResolution;
uniform float intensity;
uniform float radius;
varying vec2 vUv;
void main() {
  vec2 size = max(uResolution, vec2(1.0));
  vec2 edge = 0.5 / size;
  vec3 original = texture2D(uOriginal, clamp(vUv, edge, 1.0 - edge)).rgb;
  vec3 color = vec3(0.0);
  float total = 0.0;
  // A bounded, spatial Gaussian: radius is the outermost tap distance in pixels.
  for (int y = -3; y <= 3; y++) {
    for (int x = -3; x <= 3; x++) {
      vec2 tap = vec2(float(x), float(y));
      float weight = exp(-dot(tap, tap) / 4.5);
      vec2 uv = clamp(vUv + tap * radius / (3.0 * size), edge, 1.0 - edge);
      color += texture2D(uInput, uv).rgb * weight;
      total += weight;
    }
  }
  gl_FragColor = vec4(mix(original, color / total, intensity), 1.0);
}
