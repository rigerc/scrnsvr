precision highp float;
uniform sampler2D uInput;
uniform sampler2D uOriginal;
uniform vec2 uResolution;
uniform float intensity;
uniform int segments;
uniform float rotation;
uniform float centerX;
uniform float centerY;
uniform float zoom;
varying vec2 vUv;
void main() {
  vec2 size = max(uResolution, vec2(1.0));
  vec2 edge = 0.5 / size;
  vec2 center = vec2(centerX, centerY);
  vec2 p = (vUv - center) * size / min(size.x, size.y);
  float wedge = 6.28318530718 / max(float(segments), 2.0);
  float angle = atan(p.y, p.x + 0.0000001) - rotation * 0.01745329252;
  float folded = abs(mod(angle + wedge * 0.5, wedge) - wedge * 0.5);
  vec2 q = length(p) / max(zoom, 0.01) * vec2(cos(folded), sin(folded));
  vec2 uv = center + q * min(size.x, size.y) / size;
  // Mirror extended coordinates, rather than introducing black wedges or wrap seams.
  uv = 1.0 - abs(mod(uv, 2.0) - 1.0);
  vec3 color = texture2D(uInput, clamp(uv, edge, 1.0 - edge)).rgb;
  vec3 original = texture2D(uOriginal, clamp(vUv, edge, 1.0 - edge)).rgb;
  gl_FragColor = vec4(mix(original, color, intensity), 1.0);
}
