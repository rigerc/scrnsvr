precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float width;
uniform float sway;
uniform float brightness;
uniform vec3 color1;
uniform vec3 color2;
uniform float saturation;
uniform int ribbonCount;
uniform float spacing;
uniform float angle;
uniform float waveFrequency;
uniform float sheenStrength;
uniform vec3 background;
#else
#define uTime iTime
#define uResolution iResolution.xy
const float speed = 0.25;
const float width = 0.55;
const float sway = 0.6;
const float brightness = 1.0;
const vec3 color1 = vec3(0.917647, 0.568627, 0.717647);
const vec3 color2 = vec3(0.466667, 0.615686, 0.909804);
const float saturation = 1.0;
const int ribbonCount = 5;
const float spacing = 0.105;
const float angle = 0.0;
const float waveFrequency = 1.0;
const float sheenStrength = 1.0;
const vec3 background = vec3(0.007843, 0.007843, 0.023529);
#endif

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 p = (fragCoord / uResolution) - 0.5;
  float aspect = uResolution.x / uResolution.y;
  p.x *= aspect;
  float rotation = radians(angle);
  p = mat2(cos(rotation), sin(rotation), -sin(rotation), cos(rotation)) * p;
  float x = p.x;
  float t = uTime * speed;
  vec3 color = background;
  for (int i = 0; i < 8; i++) {
    if (i >= ribbonCount) continue;
    float layer = float(i);
    float phase = x * 1.8 * waveFrequency + layer * 0.65;
    float center = (layer - (float(ribbonCount) - 1.0) * 0.5) * spacing
      + sway * 0.21 * sin(phase + t * 0.32)
      + 0.055 * cos(x * 3.1 * waveFrequency - t * 0.23 + layer);
    float halfWidth = mix(0.012, 0.095, width) * (0.7 + 0.3 * sin(phase - t * 0.21));
    float distance = (p.y - center) / halfWidth;
    float body = exp(-distance * distance * 1.8);
    float edgeDistance = (distance - 0.65) * 5.0;
    float edge = exp(-edgeDistance * edgeDistance);
    float sheen = 0.55 + 0.45 * sin(phase * 1.3 - t * 0.19 + layer);
    vec3 tint = mix(color1, color2, 0.5 + 0.5 * sin(layer * 0.9 + x * 0.6 + t * 0.12));
    color += tint * (body * 0.36 + edge * 0.15 * sheenStrength) * sheen;
  }
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  fragColor = vec4(clamp((1.0 - exp(-color * brightness)) + (dither - 0.5) / 255.0 * min(brightness, 1.0), 0.0, 1.0), 1.0);
  float luminance = dot(fragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  fragColor.rgb = mix(vec3(luminance), fragColor.rgb, saturation);
}
