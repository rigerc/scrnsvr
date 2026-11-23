precision highp float;
uniform sampler2D uInput;
uniform sampler2D uOriginal;
uniform vec2 uResolution;
uniform float intensity;
uniform float strength;
uniform float radius;
uniform float softness;
uniform vec3 edgeColor;
varying vec2 vUv;
void main() {
  vec2 size = max(uResolution, vec2(1.0));
  vec2 uv = clamp(vUv, 0.5 / size, 1.0 - 0.5 / size);
  vec3 original = texture2D(uOriginal, uv).rgb;
  vec3 color = texture2D(uInput, uv).rgb;
  // Elliptical distance frames landscape and portrait without narrowing the short axis.
  float distance = length((vUv - 0.5) * 2.0) / 1.41421356237;
  float width = max(softness * 0.6, 1.0 / min(size.x, size.y));
  float shade = smoothstep(radius - width, radius + width, distance) * strength;
  color = mix(color, edgeColor, shade);
  gl_FragColor = vec4(mix(original, color, intensity), 1.0);
}
