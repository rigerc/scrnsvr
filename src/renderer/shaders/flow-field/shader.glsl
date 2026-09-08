precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float scale;
uniform float brightness;
uniform bool trail;
uniform int palette;
uniform vec3 color;

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
  float t = uTime * speed;
  float flow = sin((p.x + sin(p.y * 2.7 + t)) * 6.0 * scale - t);
  flow += cos((p.y + cos(p.x * 2.1 - t * 0.7)) * 5.0 * scale + t * 0.6);
  float glow = 0.5 + 0.5 * sin(flow + length(p) * 5.0 - t);
  vec3 base = palette == 1 ? vec3(glow) : mix(vec3(0.015, 0.03, 0.08), color, glow);
  if (trail) base += 0.08 * color / max(0.08, abs(flow));
  gl_FragColor = vec4(base * brightness, 1.0);
}
