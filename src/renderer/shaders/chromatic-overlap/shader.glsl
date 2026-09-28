precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float size;
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
const float size = 1.0;
const float softness = 0.012;
const float travel = 1.0;
const float opacity = 0.8;
const vec3 color1 = vec3(0.937255, 0.694118, 0.549020);
const vec3 color2 = vec3(0.709804, 0.639216, 0.862745);
const vec3 color3 = vec3(0.454902, 0.741176, 0.709804);
const vec3 background = vec3(0.941176, 0.909804, 0.858824);
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
  float aa = max(softness, 1.5 / min(uResolution.x, uResolution.y));
  vec3 color = background;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float phase = fi * 2.094395;
    vec2 center = travel * vec2(0.22 * min(aspect.x, 1.8) * cos(t * (0.18 + fi * 0.021) + phase),
      0.20 * sin(t * (0.21 - fi * 0.017) + phase));
    vec2 q = p - center;
    float a = 0.35 * sin(t * 0.13 + phase) + phase;
    q = mat2(cos(a), -sin(a), sin(a), cos(a)) * q;
    // The middle shape is a capsule; the others remain circular.
    q.x -= clamp(q.x, -0.12 * size * float(i == 1), 0.12 * size * float(i == 1));
    float radius = size * (i == 1 ? 0.23 : 0.30);
    float mask = 1.0 - smoothstep(radius - aa, radius + aa, length(q));
    vec3 tint = i == 0 ? color1 : (i == 1 ? color2 : color3);
    tint = mix(tint, vec3(1.0), 0.13 * clamp(0.5 + q.y / (2.0 * radius), 0.0, 1.0));
    // Multiplicative pigment keeps intersections visible without a lighting model.
    color *= mix(vec3(1.0), tint, mask * opacity);
  }
  fragColor = finish(color);
}
