precision highp float;
uniform sampler2D uInput;
uniform sampler2D uOriginal;
uniform vec2 uResolution;
uniform float uTime;
uniform float intensity;
uniform float strength;
uniform float scale;
uniform float speed;
varying vec2 vUv;
void main() {
  vec2 size = max(uResolution, vec2(1.0));
  vec2 edge = 0.5 / size;
  vec2 p = (vUv - 0.5) * size / min(size.x, size.y);
  float t = uTime * speed;
  vec2 waves = vec2(sin(p.y * scale * 6.28318530718 + t * 0.8 + sin(p.x * scale * 3.0 - t * 0.4)),
    sin(p.x * scale * 6.28318530718 - t * 0.65 + sin(p.y * scale * 3.0 + t * 0.3)));
  vec2 uv = vUv + waves * strength * 0.035 * min(size.x, size.y) / size;
  vec3 color = texture2D(uInput, clamp(uv, edge, 1.0 - edge)).rgb;
  vec3 original = texture2D(uOriginal, clamp(vUv, edge, 1.0 - edge)).rgb;
  gl_FragColor = vec4(mix(original, color, intensity), 1.0);
}
