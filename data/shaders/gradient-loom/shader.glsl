precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float width;
uniform float softness;
uniform float travel;
uniform float opacity;
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
const float width = 0.15;
const float softness = 0.012;
const float travel = 0.7;
const float opacity = 0.7;
const vec3 color1 = vec3(0.858824, 0.650980, 0.615686);
const vec3 color2 = vec3(0.658824, 0.670588, 0.815686);
const vec3 color3 = vec3(0.552941, 0.721569, 0.674510);
const vec3 background = vec3(0.937255, 0.898039, 0.827451);
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
  float t = uTime * speed;
  vec3 color = background;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    bool vertical = i < 3;
    float index = mod(fi, 3.0);
    float axis = vertical ? p.x : p.y;
    float along = vertical ? p.y : p.x;
    float center = (index - 1.0) * 0.31 + travel * 0.07 * sin(t * (0.15 + fi * 0.012) + fi * 1.6);
    float halfWidth = width * 0.5 * (1.0 + travel * 0.18 * cos(t * 0.2 + fi));
    float aa = max(softness, 1.5 / (vertical ? uResolution.x : uResolution.y));
    float mask = 1.0 - smoothstep(halfWidth - aa, halfWidth + aa, abs(axis - center));
    vec3 tint = palette(index * 0.5);
    tint = mix(tint, vec3(1.0), 0.23 * smoothstep(-0.5, 0.5, along));
    color *= mix(vec3(1.0), tint, mask * opacity);
  }
  fragColor = finish(color);
}
