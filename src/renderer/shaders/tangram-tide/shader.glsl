precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform int pieces;
uniform float size;
uniform float travel;
uniform float turn;
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
const int pieces = 7;
const float size = 0.11;
const float travel = 0.8;
const float turn = 0.7;
const vec3 color1 = vec3(0.796078, 0.662745, 0.545098);
const vec3 color2 = vec3(0.713725, 0.560784, 0.623529);
const vec3 color3 = vec3(0.545098, 0.670588, 0.698039);
const vec3 background = vec3(0.168627, 0.188235, 0.254902);
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
  vec2 p = (fragCoord / uResolution - 0.5) * aspect;
  float t = uTime * speed;
  float aa = 1.5 / min(uResolution.x, uResolution.y);
  float rows = ceil(float(pieces) / 3.0);
  vec3 color = background;
  for (int i = 0; i < 9; i++) {
    if (i >= pieces) continue;
    float fi = float(i);
    float row = floor(fi / 3.0);
    float columns = min(3.0, float(pieces) - row * 3.0);
    vec2 center = aspect * vec2((mod(fi, 3.0) - (columns - 1.0) * 0.5) * 0.31,
      (row - (rows - 1.0) * 0.5) * 0.83 / rows);
    center += travel * 0.045 * vec2(sin(t * 0.21 + fi * 2.4), cos(t * 0.17 + fi));
    vec2 q = p - center;
    float a = fi * 0.57 + turn * 0.24 * sin(t * 0.19 + fi * 1.7);
    q = mat2(cos(a), -sin(a), sin(a), cos(a)) * q;
    float kind = mod(fi + row, 3.0);
    float distance;
    if (kind < 0.5) distance = max(max(-q.x - size, -q.y - size), (q.x + q.y) * 0.707107);
    else if (kind < 1.5) distance = max(abs(q.y) - size * 0.72, (abs(q.x) - size * 0.82 - q.y * 0.32) / 1.05);
    else distance = max(abs(q.y) - size * 0.65, (abs(q.x + q.y * 0.5) - size * 0.75) / 1.118034);
    float mask = 1.0 - smoothstep(-aa, aa, distance);
    vec3 tint = palette(kind * 0.5);
    tint *= 0.86 + 0.14 * smoothstep(-size, size, q.x + q.y * 0.4);
    color = mix(color, tint, mask);
  }
  fragColor = finish(color);
}
