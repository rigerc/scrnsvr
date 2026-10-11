precision highp float;
uniform sampler2D uInput;
uniform sampler2D uOriginal;
uniform vec2 uResolution;
uniform float intensity;
uniform float curvature;
uniform float maskStrength;
uniform float scanlines;
uniform float edgeFalloff;
varying vec2 vUv;
vec3 sampleImage(vec2 uv) {
  vec2 edge = 0.5 / max(uResolution, vec2(1.0));
  return texture2D(uInput, clamp(uv, edge, 1.0 - edge)).rgb;
}
void main() {
  vec2 size = max(uResolution, vec2(1.0));
  vec2 edge = 0.5 / size;
  vec3 original = texture2D(uOriginal, clamp(vUv, edge, 1.0 - edge)).rgb;
  vec2 p = vUv * 2.0 - 1.0;
  // The curvature scales relative to the screen, not a landscape-only circle.
  vec2 uv = 0.5 + p * (1.0 + curvature * 0.22 * dot(p, p)) * 0.5;
  vec3 color = sampleImage(uv);
  float stripe = mod(floor(vUv.x * size.x), 3.0);
  vec3 phosphor = stripe < 1.0 ? vec3(1.0, 0.65, 0.65) :
    (stripe < 2.0 ? vec3(0.65, 1.0, 0.65) : vec3(0.65, 0.65, 1.0));
  color *= mix(vec3(1.0), phosphor, maskStrength);
  color *= 1.0 - scanlines * 0.3 * mod(floor(vUv.y * size.y), 2.0);
  float rim = smoothstep(0.45, 1.35, length(p * vec2(0.8, 0.8)));
  color *= 1.0 - edgeFalloff * rim * 0.8;
  gl_FragColor = vec4(mix(original, clamp(color, 0.0, 1.0), intensity), 1.0);
}
