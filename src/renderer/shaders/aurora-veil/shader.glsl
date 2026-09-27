precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float waves;
uniform float spread;
uniform float brightness;
uniform vec3 color1;
uniform vec3 color2;
uniform float saturation;
uniform int curtains;
uniform float verticalPosition;
uniform float amplitude;
uniform float foldDetail;
uniform vec3 background;
uniform vec3 backgroundTop;
#else
#define uTime iTime
#define uResolution iResolution.xy
const float speed = 0.3;
const float waves = 1.5;
const float spread = 0.45;
const float brightness = 1.0;
const vec3 color1 = vec3(0.219608, 0.909804, 0.729412);
const vec3 color2 = vec3(0.572549, 0.439216, 1.000000);
const float saturation = 1.0;
const int curtains = 3;
const float verticalPosition = 0.0;
const float amplitude = 1.0;
const float foldDetail = 1.0;
const vec3 background = vec3(0.007843, 0.015686, 0.050980);
const vec3 backgroundTop = vec3(0.035294, 0.054902, 0.129412);
#endif

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 p = (fragCoord / uResolution);
  float t = uTime * speed;
  vec3 color = mix(background, backgroundTop, p.y);
  for (int i = 0; i < 5; i++) {
    if (i >= curtains) continue;
    float layer = float(i);
    float phase = p.x * waves * 3.0 + layer * 1.8;
    float center = 0.3 + verticalPosition + layer * 0.17
      + amplitude * 0.12 * sin(phase + t * 0.35)
      + amplitude * 0.05 * sin(phase * 2.3 - t * 0.27);
    float distance = p.y - center;
    // A narrow lower edge opens into a broad translucent curtain above it.
    float width = mix(0.025, 0.12, spread) * (1.0 + 2.5 * smoothstep(-0.02, 0.2, distance));
    float curtain = exp(-distance * distance / (width * width));
    float folds = 0.72 + 0.28 * sin(phase * 5.0 * foldDetail + sin(phase * 1.7 + t * 0.2) - t * 0.4);
    vec3 tint = mix(color1, color2, 0.5 + 0.5 * sin(p.x * 2.5 + layer * 1.6 + t * 0.15));
    color += tint * curtain * folds * 0.5 * brightness;
  }
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  fragColor = vec4(clamp(color + (dither - 0.5) / 255.0, 0.0, 1.0), 1.0);
  float luminance = dot(fragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  fragColor.rgb = mix(vec3(luminance), fragColor.rgb, saturation);
}
