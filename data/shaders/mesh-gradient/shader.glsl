precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float blend;
uniform float warp;
uniform vec3 color1;
uniform vec3 color2;
uniform vec3 color3;
uniform vec3 color4;
uniform float brightness;
uniform float saturation;
uniform float movementRange;
uniform float spreadX;
uniform float spreadY;
uniform float warpFrequency;
uniform float influence1;
uniform float influence2;
uniform float influence3;
uniform float influence4;
#else
#define uTime iTime
#define uResolution iResolution.xy
const float speed = 0.35;
const float blend = 0.5;
const float warp = 0.45;
const vec3 color1 = vec3(0.439216, 0.317647, 0.937255);
const vec3 color2 = vec3(1.000000, 0.545098, 0.701961);
const vec3 color3 = vec3(0.270588, 0.874510, 0.811765);
const vec3 color4 = vec3(1.000000, 0.768627, 0.501961);
const float brightness = 1.0;
const float saturation = 1.0;
const float movementRange = 0.18;
const float spreadX = 1.0;
const float spreadY = 1.0;
const float warpFrequency = 1.0;
const float influence1 = 1.0;
const float influence2 = 1.0;
const float influence3 = 1.0;
const float influence4 = 1.0;
#endif

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  float t = uTime * speed;
  // Normalized coordinates let the mesh fill both portrait and wide displays.
  vec2 p = (fragCoord / uResolution) + warp * 0.16 * vec2(
    sin((fragCoord / uResolution).y * 5.0 * warpFrequency + t * 0.37),
    cos((fragCoord / uResolution).x * 4.0 * warpFrequency - t * 0.29)
  );
  p = (p - 0.5) / vec2(spreadX, spreadY) + 0.5;
  vec2 a = vec2(0.2, 0.2) + movementRange * vec2(sin(t * 0.43), cos(t * 0.37));
  vec2 b = vec2(0.8, 0.25) + movementRange * vec2(cos(t * 0.31), sin(t * 0.41));
  vec2 c = vec2(0.25, 0.8) + movementRange * vec2(cos(t * 0.39), sin(t * 0.33));
  vec2 d = vec2(0.8, 0.8) + movementRange * vec2(sin(t * 0.35), cos(t * 0.45));
  vec4 distances = vec4(dot(p-a, p-a), dot(p-b, p-b), dot(p-c, p-c), dot(p-d, p-d));
  // Subtract the nearest distance so weights remain stable even at low blend.
  distances -= min(min(distances.x, distances.y), min(distances.z, distances.w));
  vec4 weights = exp(-distances * mix(24.0, 3.0, blend)) * vec4(influence1, influence2, influence3, influence4);
  vec3 color = (color1 * weights.x + color2 * weights.y + color3 * weights.z + color4 * weights.w)
    / dot(weights, vec4(1.0));
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  fragColor = vec4(clamp(color + (dither - 0.5) / 255.0, 0.0, 1.0), 1.0);
  fragColor.rgb *= brightness;
  float luminance = dot(fragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  fragColor.rgb = mix(vec3(luminance), fragColor.rgb, saturation);
}
