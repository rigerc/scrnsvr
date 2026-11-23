precision highp float;
uniform sampler2D uInput;
uniform sampler2D uOriginal;
uniform vec2 uResolution;
uniform float intensity;
uniform float amount;
uniform float direction;
uniform float edgeBias;
varying vec2 vUv;
vec3 sampleImage(vec2 uv) {
  vec2 edge = 0.5 / max(uResolution, vec2(1.0));
  return texture2D(uInput, clamp(uv, edge, 1.0 - edge)).rgb;
}
void main() {
  vec2 size = max(uResolution, vec2(1.0));
  vec3 original = texture2D(uOriginal, clamp(vUv, 0.5 / size, 1.0 - 0.5 / size)).rgb;
  vec2 p = (vUv - 0.5) * size / min(size.x, size.y);
  float bias = mix(1.0, smoothstep(0.0, 0.7, length(p)), edgeBias);
  float angle = direction * 0.01745329252;
  vec2 shift = vec2(cos(angle), sin(angle)) * amount * bias * min(size.x, size.y) * 0.035 / size;
  vec3 color = sampleImage(vUv);
  color.r = sampleImage(vUv + shift).r;
  color.b = sampleImage(vUv - shift).b;
  gl_FragColor = vec4(mix(original, color, intensity), 1.0);
}
