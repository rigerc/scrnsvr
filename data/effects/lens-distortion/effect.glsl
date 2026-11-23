precision highp float;
uniform sampler2D uInput;
uniform sampler2D uOriginal;
uniform vec2 uResolution;
uniform float intensity;
uniform float distortion;
uniform float zoom;
uniform float centerX;
uniform float centerY;
varying vec2 vUv;
void main() {
  vec2 size = max(uResolution, vec2(1.0));
  vec2 edge = 0.5 / size;
  vec2 center = vec2(centerX, centerY);
  vec2 p = (vUv - center) * size / min(size.x, size.y);
  float r2 = dot(p, p);
  // Bounded radial lens response remains positive even at maximum pincushion.
  float radial = 1.0 + distortion * 0.65 * r2 / (1.0 + r2);
  vec2 uv = center + p * radial / max(zoom, 0.01) * min(size.x, size.y) / size;
  vec3 color = texture2D(uInput, clamp(uv, edge, 1.0 - edge)).rgb;
  vec3 original = texture2D(uOriginal, clamp(vUv, edge, 1.0 - edge)).rgb;
  gl_FragColor = vec4(mix(original, color, intensity), 1.0);
}
