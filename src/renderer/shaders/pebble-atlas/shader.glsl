precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float cellScale;
uniform float gap;
uniform float softness;
uniform float wander;
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
const float cellScale = 2.5;
const float gap = 0.05;
const float softness = 0.02;
const float wander = 0.75;
const vec3 color1 = vec3(0.619608, 0.686275, 0.643137);
const vec3 color2 = vec3(0.713725, 0.650980, 0.592157);
const vec3 color3 = vec3(0.556863, 0.623529, 0.705882);
const vec3 background = vec3(0.870588, 0.843137, 0.788235);
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

vec2 cellSeed(vec2 cell) {
  return fract(sin(vec2(dot(cell, vec2(127.1, 311.7)), dot(cell, vec2(269.5, 183.3)))) * 43758.5453);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 p = (fragCoord / uResolution - 0.5) * uResolution / min(uResolution.x, uResolution.y) * cellScale;
  float t = uTime * speed;
  vec2 cell = floor(p);
  float nearest = 100.0;
  float nextNearest = 100.0;
  vec2 chosenSeed = vec2(0.0);
  vec2 local = vec2(0.0);
  // Centers stay within their cells, so a fixed neighborhood covers every nearest site.
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 id = cell + vec2(float(x), float(y));
      vec2 seed = cellSeed(id);
      vec2 center = id + 0.5 + wander * 0.23 * sin(seed * 6.283185 + t * vec2(0.19, 0.23));
      vec2 q = p - center;
      float distance = length(q);
      if (distance < nearest) {
        nextNearest = nearest;
        nearest = distance;
        chosenSeed = seed;
        local = q;
      } else {
        nextNearest = min(nextNearest, distance);
      }
    }
  }
  float aa = max(softness, 1.5 * cellScale / min(uResolution.x, uResolution.y));
  float mask = smoothstep(gap, gap + aa, nextNearest - nearest);
  vec3 tint = palette(chosenSeed.x);
  tint *= 0.91 + 0.09 * smoothstep(-0.7, 0.7, local.y);
  fragColor = finish(mix(background, tint, mask));
}
