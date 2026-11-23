precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform int fanCount;
uniform float radius;
uniform float opening;
uniform float flutter;
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
const int fanCount = 2;
const float radius = 0.65;
const float opening = 2.2;
const float flutter = 0.7;
const vec3 color1 = vec3(0.776471, 0.556863, 0.474510);
const vec3 color2 = vec3(0.894118, 0.705882, 0.607843);
const vec3 color3 = vec3(0.470588, 0.384314, 0.494118);
const vec3 background = vec3(0.898039, 0.850980, 0.784314);
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

vec3 wedgeColor(float index, float fan) {
  return palette(0.5 + 0.5 * sin(index * 1.35 + fan * 2.1));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 aspect = uResolution / min(uResolution.x, uResolution.y);
  vec2 p = (fragCoord / uResolution - 0.5) * aspect;
  float t = uTime * speed;
  float aa = 1.5 / min(uResolution.x, uResolution.y);
  vec3 color = background;
  for (int i = 0; i < 3; i++) {
    if (i >= fanCount) continue;
    float fi = float(i);
    vec2 center = i == 0 ? vec2(-0.30, -0.30) : (i == 1 ? vec2(0.29, 0.30) : vec2(0.15, -0.35));
    vec2 q = p - center * aspect;
    float r = length(q);
    float direction = (i == 1 ? -2.05 : 1.08) + flutter * 0.12 * sin(t * 0.18 + fi * 2.0);
    float theta = r < 0.00001 ? direction : atan(q.y, q.x);
    float angle = atan(sin(theta - direction), cos(theta - direction));
    float spread = opening * (1.0 + flutter * 0.08 * sin(t * 0.22 + fi));
    float angularAA = aa / max(r, 0.02);
    float mask = (1.0 - smoothstep(radius - aa, radius + aa, r))
      * (1.0 - smoothstep(spread * 0.5 - angularAA, spread * 0.5 + angularAA, abs(angle)));
    float wedge = clamp(angle / spread + 0.5, 0.0, 1.0) * 7.0;
    float index = floor(wedge);
    float blend = smoothstep(0.0, min(0.5, angularAA * 7.0 / spread), fract(wedge));
    vec3 tint = mix(wedgeColor(index - 1.0, fi), wedgeColor(index, fi), blend);
    tint *= 0.9 + 0.1 * smoothstep(0.0, radius, r);
    color = mix(color, tint, mask * 0.88);
  }
  fragColor = finish(color);
}
