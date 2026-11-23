precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform int layers;
uniform float waveHeight;
uniform float wavelength;
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
const int layers = 4;
const float waveHeight = 0.09;
const float wavelength = 1.0;
const float sway = 0.7;
const vec3 color1 = vec3(0.643137, 0.709804, 0.643137);
const vec3 color2 = vec3(0.862745, 0.784314, 0.654902);
const vec3 color3 = vec3(0.384314, 0.498039, 0.572549);
const vec3 background = vec3(0.909804, 0.874510, 0.811765);
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
  vec2 p = fragCoord / uResolution - 0.5;
  float x = p.x * uResolution.x / min(uResolution.x, uResolution.y) / wavelength;
  float t = uTime * speed;
  float aa = 1.5 / uResolution.y;
  vec3 color = mix(background, background * 0.92, fragCoord.y / uResolution.y);
  for (int i = 0; i < 6; i++) {
    if (i >= layers) continue;
    float fi = float(i);
    float phase = fi / max(float(layers - 1), 1.0);
    float boundary = 0.20 - phase * 0.53
      + waveHeight * sin(x * 3.2 + fi * 1.3 + t * (0.16 + fi * 0.009))
      + waveHeight * 0.35 * cos(x * 5.1 - t * 0.12 + fi)
      + sway * 0.035 * sin(t * 0.20 + fi * 0.8);
    float mask = 1.0 - smoothstep(boundary - aa, boundary + aa, p.y);
    vec3 tint = palette(phase);
    tint *= 0.9 + 0.1 * smoothstep(-0.5, boundary, p.y);
    color = mix(color, tint, mask);
  }
  fragColor = finish(color);
}
