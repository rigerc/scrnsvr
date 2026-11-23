precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform int islandCount;
uniform float size;
uniform float undulation;
uniform float drift;
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
const int islandCount = 3;
const float size = 0.23;
const float undulation = 0.12;
const float drift = 0.7;
const vec3 color1 = vec3(0.603922, 0.686275, 0.627451);
const vec3 color2 = vec3(0.870588, 0.850980, 0.745098);
const vec3 color3 = vec3(0.458824, 0.639216, 0.643137);
const vec3 background = vec3(0.160784, 0.231373, 0.282353);
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
  vec3 color = background;
  for (int i = 0; i < 5; i++) {
    if (i >= islandCount) continue;
    float fi = float(i);
    float phase = fi * 6.283185 / float(islandCount) + 0.5;
    vec2 center = islandCount == 1 ? vec2(0.0) : 0.29 * aspect * vec2(cos(phase), sin(phase));
    center += drift * 0.025 * vec2(sin(t * 0.16 + phase), cos(t * 0.2 + phase));
    for (int j = 0; j < 3; j++) {
      float fj = float(j);
      vec2 q = p - center - drift * fj * 0.01 * vec2(sin(t * 0.23 + phase), cos(t * 0.17 + phase));
      float r = length(q);
      float a = r < 0.00001 ? 0.0 : atan(q.y, q.x);
      float radius = size * pow(0.69, fj) * (1.0 + drift * 0.045 * sin(t * 0.22 + fi));
      radius *= 1.0 + undulation * (0.65 * sin(a * 3.0 + phase + t * 0.14)
        + 0.35 * cos(a * 5.0 - t * 0.12 + fi));
      float mask = 1.0 - smoothstep(radius - aa, radius + aa, r);
      vec3 tint = palette(mod(fj + fi, 3.0) * 0.5);
      tint *= 0.92 + 0.08 * smoothstep(-size, size, q.y);
      color = mix(color, tint, mask);
    }
  }
  fragColor = finish(color);
}
