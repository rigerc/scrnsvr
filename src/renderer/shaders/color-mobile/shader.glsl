precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform int shapeCount;
uniform float size;
uniform float sway;
uniform float travel;
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
const int shapeCount = 6;
const float size = 1.0;
const float sway = 0.8;
const float travel = 0.6;
const vec3 color1 = vec3(0.894118, 0.792157, 0.517647);
const vec3 color2 = vec3(0.800000, 0.549020, 0.509804);
const vec3 color3 = vec3(0.470588, 0.584314, 0.596078);
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
  vec3 color = background;
  for (int i = 0; i < 8; i++) {
    if (i >= shapeCount) continue;
    float fi = float(i);
    float phase = fi * 2.399963;
    // Staggered rows give the pieces room to rock without crowding their neighbors.
    float rows = ceil(float(shapeCount) / 3.0);
    vec2 center = aspect * vec2((mod(fi, 3.0) - 1.0) * 0.30,
      (floor(fi / 3.0) - (rows - 1.0) * 0.5) * 0.62 / rows);
    center += 0.035 * vec2(sin(phase), cos(phase));
    center += travel * 0.045 * vec2(sin(t * 0.19 + phase), cos(t * 0.23 + phase));
    vec2 q = p - center;
    float a = phase * 0.5 + sway * 0.25 * sin(t * 0.2 + phase);
    q = mat2(cos(a), -sin(a), sin(a), cos(a)) * q;
    float radius = size * (0.095 + 0.025 * sin(phase + 0.8));
    float kind = mod(fi + floor(fi / 3.0), 3.0);
    float distance = length(q) - radius;
    if (kind < 0.5) distance = max(length(q) - radius * 1.3, -q.y);
    else if (kind < 1.5) distance = roundedBox(q, vec2(radius * 1.35, radius * 0.48), radius * 0.3);
    float mask = 1.0 - smoothstep(-aa, aa, distance);
    vec3 tint = kind < 0.5 ? color1 : (kind < 1.5 ? color2 : color3);
    tint *= 0.85 + 0.15 * smoothstep(-radius, radius, q.y);
    color = mix(color, tint, mask);
  }
  fragColor = finish(color);
}
