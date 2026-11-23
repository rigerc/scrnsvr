precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform int layers;
uniform float roundness;
uniform float spacing;
uniform float breathing;
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
const int layers = 6;
const float roundness = 0.7;
const float spacing = 0.78;
const float breathing = 0.6;
const vec3 color1 = vec3(0.658824, 0.592157, 0.768627);
const vec3 color2 = vec3(0.509804, 0.584314, 0.737255);
const vec3 color3 = vec3(0.917647, 0.854902, 0.752941);
const vec3 background = vec3(0.203922, 0.200000, 0.305882);
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
    if (i >= layers) continue;
    float fi = float(i);
    float level = pow(spacing, fi);
    vec2 halfSize = aspect * 0.55 * level * (1.0 + breathing * 0.04 * sin(t * 0.2 + fi * 0.4));
    vec2 center = breathing * 0.055 * (1.0 - level) * aspect
      * vec2(sin(t * 0.17 + fi * 0.35), cos(t * 0.21 + fi * 0.3));
    float radius = min(halfSize.x, halfSize.y) * roundness;
    float distance = roundedBox(p - center, halfSize, radius);
    float mask = 1.0 - smoothstep(-aa, aa, distance);
    vec3 tint = palette(fi / max(float(layers - 1), 1.0));
    tint *= 0.91 + 0.09 * smoothstep(-halfSize.y, halfSize.y, p.y - center.y);
    color = mix(color, tint, mask);
  }
  fragColor = finish(color);
}
