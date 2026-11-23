precision highp float;
uniform sampler2D uInput;
uniform sampler2D uOriginal;
uniform vec2 uResolution;
uniform float intensity;
uniform int pixelSize;
uniform float gridAspect;
varying vec2 vUv;
void main() {
  vec2 size = max(uResolution, vec2(1.0));
  vec2 edge = 0.5 / size;
  vec3 original = texture2D(uOriginal, clamp(vUv, edge, 1.0 - edge)).rgb;
  float aspect = sqrt(max(gridAspect, 0.01));
  vec2 block = max(vec2(1.0), float(pixelSize) * vec2(aspect, 1.0 / aspect));
  vec2 uv = (floor(vUv * size / block) + 0.5) * block / size;
  vec3 color = texture2D(uInput, clamp(uv, edge, 1.0 - edge)).rgb;
  gl_FragColor = vec4(mix(original, color, intensity), 1.0);
}
