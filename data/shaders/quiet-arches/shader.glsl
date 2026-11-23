precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform int archCount;
uniform float size;
uniform float spacing;
uniform float sway;
uniform vec3 color1;
uniform vec3 color2;
uniform vec3 color3;
uniform vec3 background;
uniform float brightness;
uniform float saturation;
#else
#define uTime iTime
#define uResolution iResolution.xy
const float speed = 0.3;
const int archCount = 6;
const float size = 1.0;
const float spacing = 0.12;
const float sway = 0.65;
const vec3 color1 = vec3(0.733333, 0.501961, 0.431373);
const vec3 color2 = vec3(0.823529, 0.635294, 0.615686);
const vec3 color3 = vec3(0.411765, 0.317647, 0.427451);
const vec3 background = vec3(0.141176, 0.137255, 0.223529);
const float brightness = 1.0;
const float saturation = 1.0;
#endif

// Static sub-byte dithering preserves broad gradients without temporal grain.
vec4 finish(vec3 color) {
  color = clamp(color * brightness, 0.0, 1.0);
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  color = clamp(color + (dither - 0.5) / 255.0 * min(brightness, 1.0), 0.0, 1.0);
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  return vec4(clamp(mix(vec3(luminance), color, saturation), 0.0, 1.0), 1.0);
}

vec3 palette(float phase) {
  return mix(mix(color1, color2, smoothstep(0.0, 0.5, phase)), color3, smoothstep(0.5, 1.0, phase));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 aspect = uResolution / min(uResolution.x, uResolution.y);
  vec2 p = (fragCoord / uResolution - 0.5) * aspect / size;
  float t = uTime * speed;
  float aa = 1.5 / (min(uResolution.x, uResolution.y) * size);
  vec3 color = background;
  for (int i = 0; i < 8; i++) {
    if (i >= archCount) continue;
    float fi = float(i);
    float radius = 0.15 + float(archCount - 1 - i) * spacing;
    radius *= 1.0 + sway * 0.035 * sin(t * 0.18 + fi * 0.5);
    vec2 center = vec2(-0.16 + sway * 0.05 * sin(t * 0.22 + fi * 0.45),
      -0.15 + sway * 0.03 * cos(t * 0.16 + fi * 0.4));
    vec2 q = p - center;
    // A semicircular roof continues into straight sides below its spring line.
    float distance = length(vec2(q.x, max(q.y, 0.0))) - radius;
    float mask = 1.0 - smoothstep(-aa, aa, distance);
    float phase = fi / max(float(archCount - 1), 1.0);
    vec3 tint = palette(phase);
    tint = mix(tint * 0.84, tint, smoothstep(-0.6, 0.8, q.y));
    color = mix(color, tint, mask);
  }
  fragColor = finish(color);
}
