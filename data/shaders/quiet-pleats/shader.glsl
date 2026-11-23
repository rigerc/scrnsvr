precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform int folds;
uniform float angle;
uniform float compression;
uniform float depth;
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
const int folds = 7;
const float angle = -12.0;
const float compression = 0.65;
const float depth = 0.3;
const vec3 color1 = vec3(0.705882, 0.647059, 0.776471);
const vec3 color2 = vec3(0.490196, 0.545098, 0.615686);
const vec3 color3 = vec3(0.886275, 0.835294, 0.745098);
const vec3 background = vec3(0.266667, 0.270588, 0.345098);
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
  vec2 p = (fragCoord / uResolution - 0.5) * uResolution / min(uResolution.x, uResolution.y);
  float t = uTime * speed;
  float a = radians(angle);
  p = mat2(cos(a), -sin(a), sin(a), cos(a)) * p;
  // The warp derivative stays below the base frequency, so folds never cross.
  float phase = p.x * float(folds) + compression * 0.42 * sin(p.x * 2.1 + t * 0.19)
    + 0.07 * sin(p.y * 1.8 - t * 0.15);
  float pleat = 1.0 - abs(fract(phase) * 2.0 - 1.0);
  vec3 tint = palette(0.5 + 0.5 * sin(p.x * 2.2 + 0.6 * sin(t * 0.12)));
  vec3 color = mix(background, tint, 1.0 - depth * (1.0 - pleat));
  fragColor = finish(color);
}
