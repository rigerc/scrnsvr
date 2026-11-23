precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform int windowCount;
uniform float size;
uniform float travel;
uniform float fieldRate;
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
const int windowCount = 4;
const float size = 0.19;
const float travel = 0.65;
const float fieldRate = 1.0;
const vec3 color1 = vec3(0.882353, 0.674510, 0.600000);
const vec3 color2 = vec3(0.662745, 0.623529, 0.815686);
const vec3 color3 = vec3(0.474510, 0.666667, 0.654902);
const vec3 background = vec3(0.145098, 0.176471, 0.231373);
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

float roundedBox(vec2 p, vec2 halfSize, float radius) {
  vec2 q = abs(p) - halfSize + radius;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 aspect = uResolution / min(uResolution.x, uResolution.y);
  vec2 p = (fragCoord / uResolution - 0.5) * aspect;
  float t = uTime * speed;
  float aa = 1.5 / min(uResolution.x, uResolution.y);
  float field = 0.5 + 0.5 * sin(p.x * 2.2 + p.y * 2.5 - t * 0.17 * fieldRate
    + 0.4 * sin(p.y * 2.0 + t * 0.11 * fieldRate));
  vec3 pigment = palette(field);
  float mask = 0.0;
  float rows = ceil(float(windowCount) / 2.0);
  for (int i = 0; i < 6; i++) {
    if (i >= windowCount) continue;
    float fi = float(i);
    vec2 center = aspect * vec2((mod(fi, 2.0) - 0.5) * 0.48,
      (floor(fi / 2.0) - (rows - 1.0) * 0.5) * 0.90 / rows);
    center += travel * 0.045 * vec2(sin(t * 0.22 + fi * 2.1), cos(t * 0.18 + fi));
    vec2 q = p - center;
    float distance = mod(fi, 2.0) < 0.5 ? length(q) - size
      : roundedBox(q, vec2(size * 1.15, size * 0.8), size * 0.28);
    mask = max(mask, 1.0 - smoothstep(-aa, aa, distance));
  }
  fragColor = finish(mix(background, pigment, mask));
}
