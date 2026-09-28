precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float channelWidth;
uniform float curvature;
uniform float angle;
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
const float channelWidth = 0.12;
const float curvature = 0.65;
const float angle = 20.0;
const float drift = 0.75;
const vec3 color1 = vec3(0.686275, 0.780392, 0.721569);
const vec3 color2 = vec3(0.874510, 0.803922, 0.666667);
const vec3 color3 = vec3(0.549020, 0.670588, 0.709804);
const vec3 background = vec3(0.207843, 0.396078, 0.458824);
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
  p -= drift * 0.10 * vec2(sin(t * 0.19), cos(t * 0.16));
  vec2 q = p + curvature * 0.16 * vec2(sin(p.y * 3.4 + t * 0.17), sin(p.x * 3.0 - t * 0.13));
  float nearest = 100.0;
  float nextNearest = 100.0;
  vec3 tint = color1;
  // Three moving regions meet at one junction; their distance differences form the channels.
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float phase = fi * 2.094395;
    vec2 site = 0.75 * vec2(cos(phase), sin(phase));
    float distance = length(q - site);
    if (distance < nearest) {
      nextNearest = nearest;
      nearest = distance;
      tint = i == 0 ? color1 : (i == 1 ? color2 : color3);
    } else nextNearest = min(nextNearest, distance);
  }
  float width = channelWidth * (1.0 + drift * 0.12 * sin(t * 0.22 + p.y * 2.0));
  float aa = 2.5 / min(uResolution.x, uResolution.y);
  float land = smoothstep(width - aa, width + aa, nextNearest - nearest);
  tint *= 0.92 + 0.08 * smoothstep(-0.6, 0.6, p.y);
  fragColor = finish(mix(background, tint, land));
}
