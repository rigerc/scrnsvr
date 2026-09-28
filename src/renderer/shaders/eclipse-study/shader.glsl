precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float size;
uniform float separation;
uniform float softness;
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
const float size = 0.38;
const float separation = 0.85;
const float softness = 0.006;
const float drift = 0.6;
const vec3 color1 = vec3(0.917647, 0.701961, 0.584314);
const vec3 color2 = vec3(0.592157, 0.368627, 0.474510);
const vec3 color3 = vec3(0.258824, 0.231373, 0.396078);
const vec3 background = vec3(0.090196, 0.109804, 0.200000);
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
  p -= drift * vec2(0.08 * sin(t * 0.13), 0.07 * cos(t * 0.16));
  float aa = max(softness, 1.5 / min(uResolution.x, uResolution.y));
  vec3 color = mix(background, color3 * 0.75, 0.28 * (0.5 + 0.5 * p.y / aspect.y));
  vec2 a = p + vec2(0.08, 0.0);
  float disc = 1.0 - smoothstep(size - aa, size + aa, length(a));
  vec3 tint = mix(color2, color1, smoothstep(-size, size, a.y + a.x * 0.35));
  color = mix(color, tint, disc);
  vec2 offset = size * separation * vec2(0.95 * sin(t * 0.16 + 0.65), 0.35 * cos(t * 0.19 + 0.4));
  vec2 b = a - offset;
  float occulting = 1.0 - smoothstep(size * 0.9 - aa, size * 0.9 + aa, length(b));
  vec3 shade = mix(color3, background, smoothstep(-size, size, b.x - b.y * 0.6));
  color = mix(color, shade, occulting);
  fragColor = finish(color);
}
