precision highp float;

uniform float direction;
uniform float turbulence;
uniform float glowStrength;
uniform float glowWidth;
uniform vec3 background;
uniform vec3 color2;
uniform float saturation;

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
  float rotation = radians(direction);
  p = mat2(cos(rotation), sin(rotation), -sin(rotation), cos(rotation)) * p;
  float t = uTime * speed;
  float flow = sin((p.x + turbulence * sin(p.y * 2.7 + t)) * 6.0 * scale - t);
  flow += cos((p.y + turbulence * cos(p.x * 2.1 - t * 0.7)) * 5.0 * scale + t * 0.6);
  float glow = 0.5 + 0.5 * sin(flow + length(p) * 5.0 - t);
  vec3 base = palette == 1 ? vec3(glow) : mix(background, color, glow);
  if (palette == 2) base = mix(background, mix(color, color2, 0.5 + 0.5 * sin(flow * 0.7)), glow);
  if (trail) base += glowStrength * color / max(glowWidth, abs(flow));
  gl_FragColor = vec4(base * brightness, 1.0);
  float luminance = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor.rgb = mix(vec3(luminance), gl_FragColor.rgb, saturation);
}
