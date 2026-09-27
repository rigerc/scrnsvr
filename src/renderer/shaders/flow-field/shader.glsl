precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float highlightRolloff;
uniform float speed;
uniform float scale;
uniform float brightness;
uniform bool trail;
uniform int palette;
uniform vec3 color;
uniform float saturation;
uniform float direction;
uniform float turbulence;
uniform float glowStrength;
uniform float glowWidth;
uniform vec3 background;
uniform vec3 color2;
#else
#define uTime iTime
#define uResolution iResolution.xy
const float highlightRolloff = 0.0;
const float speed = 0.4;
const float scale = 1.0;
const float brightness = 1.0;
const bool trail = true;
const int palette = 0;
const vec3 color = vec3(0.266667, 0.800000, 1.000000);
const float saturation = 1.0;
const float direction = 0.0;
const float turbulence = 1.0;
const float glowStrength = 0.08;
const float glowWidth = 0.08;
const vec3 background = vec3(0.015686, 0.031373, 0.078431);
const vec3 color2 = vec3(0.678431, 0.439216, 1.000000);
#endif

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 p = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
  float rotation = radians(direction);
  p = mat2(cos(rotation), sin(rotation), -sin(rotation), cos(rotation)) * p;
  float t = uTime * speed;
  float flow = sin((p.x + turbulence * sin(p.y * 2.7 + t)) * 6.0 * scale - t);
  flow += cos((p.y + turbulence * cos(p.x * 2.1 - t * 0.7)) * 5.0 * scale + t * 0.6);
  float glow = 0.5 + 0.5 * sin(flow + length(p) * 5.0 - t);
  vec3 monoBackground = vec3(dot(background, vec3(0.2126, 0.7152, 0.0722)));
  vec3 monoColor = vec3(dot(color, vec3(0.2126, 0.7152, 0.0722)));
  vec3 base = palette == 1 ? mix(monoBackground, monoColor, glow) : mix(background, color, glow);
  if (palette == 2) base = mix(background, mix(color, color2, 0.5 + 0.5 * sin(flow * 0.7)), glow);
  if (trail) base += glowStrength * (palette == 1 ? monoColor : color) / max(glowWidth, abs(flow));
  base = mix(base, 1.0 - exp(-base), highlightRolloff);
  fragColor = vec4(base * brightness, 1.0);
  float luminance = dot(fragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  fragColor.rgb = mix(vec3(luminance), fragColor.rgb, saturation);
}
