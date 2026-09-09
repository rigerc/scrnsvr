precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float scale;
uniform float lines;
uniform float brightness;
uniform vec3 color1;
uniform vec3 color2;
varying vec2 vUv;

void main() {
  vec2 p = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0) * scale * 3.0;
  float t = uTime * speed;
  vec2 q = p + 0.55 * vec2(sin(p.y * 1.2 + t * 0.24), cos(p.x * 0.9 - t * 0.18));
  float height = 0.5 + 0.23 * sin(q.x * 1.3 + q.y * 0.7 + t * 0.12)
    + 0.16 * cos(q.y * 1.8 - q.x * 0.4 - t * 0.17)
    + 0.08 * sin(q.x * 2.1 - q.y * 1.5);
  float band = abs(fract(height * lines) - 0.5);
  // Resolution-aware soft edges prevent fine contours from shimmering in previews.
  float softness = max(0.025, lines * scale * 3.0 / uResolution.y);
  float contour = 1.0 - smoothstep(0.025, 0.025 + softness, band);
  float ridge = 0.5 + 0.5 * sin(height * 6.283185);
  vec3 color = mix(color1 * 0.6, color1 + color2 * 0.16, height)
    + color2 * contour * (0.25 + 0.25 * ridge);
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  gl_FragColor = vec4(clamp((1.0 - exp(-color * brightness)) + (dither - 0.5) / 255.0 * min(brightness, 1.0), 0.0, 1.0), 1.0);
}
