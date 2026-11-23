precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float scale;
uniform float warp;
uniform vec3 shadow;
uniform vec3 midtone;
uniform vec3 highlight;
uniform float brightness;
uniform float saturation;
uniform float angle;
uniform float rotationRate;
uniform float driftRate;
uniform float warpFrequency;
uniform float midtonePosition;
#else
#define uTime iTime
#define uResolution iResolution.xy
const float speed = 0.3;
const float scale = 1.0;
const float warp = 0.35;
const vec3 shadow = vec3(0.160784, 0.129412, 0.419608);
const vec3 midtone = vec3(0.905882, 0.474510, 0.666667);
const vec3 highlight = vec3(1.000000, 0.839216, 0.627451);
const float brightness = 1.0;
const float saturation = 1.0;
const float angle = 0.0;
const float rotationRate = 1.0;
const float driftRate = 1.0;
const float warpFrequency = 1.0;
const float midtonePosition = 0.55;
#endif

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  // UVs stay independent of pixel density; preserve shapes at any aspect ratio.
  vec2 p = ((fragCoord / uResolution) - 0.5) * uResolution / min(uResolution.x, uResolution.y);
  float t = uTime * speed;
  vec2 direction = vec2(cos(t * 0.13 * rotationRate + 0.6 + radians(angle)), sin(t * 0.13 * rotationRate + 0.6 + radians(angle)));
  float bend = sin(p.y * 2.4 * warpFrequency + t * 0.4) * cos(p.x * 1.8 * warpFrequency - t * 0.3);
  float phase = dot(p, direction) * scale * 2.7 + bend * warp + t * 0.25 * driftRate;
  float gradient = 0.5 + 0.5 * sin(phase);
  vec3 color = mix(shadow, midtone, smoothstep(0.0, midtonePosition, gradient));
  color = mix(color, highlight, smoothstep(midtonePosition - 0.1, 1.0, gradient));
  // Static sub-byte dithering keeps broad gradients smooth without flicker.
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  fragColor = vec4(clamp(color + (dither - 0.5) / 255.0, 0.0, 1.0), 1.0);
  fragColor.rgb *= brightness;
  float luminance = dot(fragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  fragColor.rgb = mix(vec3(luminance), fragColor.rgb, saturation);
}
