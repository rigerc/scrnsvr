precision highp float;
uniform sampler2D uInput;
uniform sampler2D uOriginal;
uniform vec2 uResolution;
uniform float intensity;
uniform float warmth;
uniform float tint;
uniform float contrast;
uniform float saturation;
uniform float fade;
varying vec2 vUv;
void main() {
  vec2 size = max(uResolution, vec2(1.0));
  vec2 uv = clamp(vUv, 0.5 / size, 1.0 - 0.5 / size);
  vec3 original = texture2D(uOriginal, uv).rgb;
  vec3 color = texture2D(uInput, uv).rgb;
  color *= vec3(1.0 + warmth * 0.2 + tint * 0.08, 1.0 - tint * 0.16, 1.0 - warmth * 0.2 + tint * 0.08);
  color = (color - 0.5) * contrast + 0.5;
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luma), color, saturation);
  color = clamp(color, 0.0, 1.0);
  color += fade * 0.3 * (1.0 - color);
  gl_FragColor = vec4(mix(original, color, intensity), 1.0);
}
