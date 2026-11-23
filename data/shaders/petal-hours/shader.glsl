precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform int petals;
uniform float size;
uniform float opening;
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
const int petals = 5;
const float size = 1.0;
const float opening = 0.08;
const float sway = 0.7;
const vec3 color1 = vec3(0.827451, 0.611765, 0.592157);
const vec3 color2 = vec3(0.647059, 0.549020, 0.682353);
const vec3 color3 = vec3(0.894118, 0.807843, 0.584314);
const vec3 background = vec3(0.211765, 0.200000, 0.266667);
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
  vec2 p = (fragCoord / uResolution - 0.5) * aspect / size - vec2(-0.06, 0.025);
  float t = uTime * speed;
  float aa = 1.5 / (min(uResolution.x, uResolution.y) * size);
  vec3 color = background;
  for (int i = 0; i < 6; i++) {
    if (i >= petals) continue;
    float fi = float(i);
    float phase = fi * 6.283185 / float(petals);
    float a = phase + sway * 0.16 * sin(t * 0.18 + phase);
    vec2 radial = vec2(cos(a), sin(a));
    vec2 tangent = vec2(-radial.y, radial.x);
    float lengthwise = 0.17 + sway * 0.025 * sin(t * 0.23 + phase * 1.4);
    vec2 center = radial * (opening + lengthwise);
    vec2 q = vec2(dot(p - center, radial), dot(p - center, tangent));
    q.y += sway * 0.12 * q.x * sin(t * 0.2 + phase);
    vec2 radii = vec2(lengthwise, 0.13);
    float distance = (length(q / radii) - 1.0) * min(radii.x, radii.y);
    float mask = 1.0 - smoothstep(-aa, aa, distance);
    vec3 tint = palette(fi / max(float(petals - 1), 1.0));
    tint *= 0.83 + 0.17 * smoothstep(-lengthwise, lengthwise, q.x);
    color = mix(color, tint, mask);
  }
  fragColor = finish(color);
}
