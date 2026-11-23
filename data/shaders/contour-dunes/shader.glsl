precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float scale;
uniform float lines;
uniform float brightness;
uniform vec3 color1;
uniform vec3 color2;
uniform float saturation;
uniform float lineThickness;
uniform float edgeSoftness;
uniform float distortion;
uniform float fineDetail;
uniform float angle;
uniform float contourIntensity;
#else
#define uTime iTime
#define uResolution iResolution.xy
const float speed = 0.2;
const float scale = 1.0;
const float lines = 10.0;
const float brightness = 1.0;
const vec3 color1 = vec3(0.098039, 0.152941, 0.266667);
const vec3 color2 = vec3(0.839216, 0.627451, 0.419608);
const float saturation = 1.0;
const float lineThickness = 0.025;
const float edgeSoftness = 0.025;
const float distortion = 0.55;
const float fineDetail = 0.08;
const float angle = 0.0;
const float contourIntensity = 1.0;
#endif

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 p = ((fragCoord / uResolution) - 0.5) * vec2(uResolution.x / uResolution.y, 1.0) * scale * 3.0;
  float rotation = radians(angle);
  p = mat2(cos(rotation), sin(rotation), -sin(rotation), cos(rotation)) * p;
  float t = uTime * speed;
  vec2 q = p + distortion * vec2(sin(p.y * 1.2 + t * 0.24), cos(p.x * 0.9 - t * 0.18));
  float height = 0.5 + 0.23 * sin(q.x * 1.3 + q.y * 0.7 + t * 0.12)
    + 0.16 * cos(q.y * 1.8 - q.x * 0.4 - t * 0.17)
    + fineDetail * sin(q.x * 2.1 - q.y * 1.5);
  float band = abs(fract(height * lines) - 0.5);
  // Resolution-aware soft edges prevent fine contours from shimmering in previews.
  float softness = max(edgeSoftness, lines * scale * 3.0 / uResolution.y);
  float contour = 1.0 - smoothstep(lineThickness, lineThickness + softness, band);
  float ridge = 0.5 + 0.5 * sin(height * 6.283185);
  vec3 color = mix(color1 * 0.6, color1 + color2 * 0.16, height)
    + color2 * contourIntensity * contour * (0.25 + 0.25 * ridge);
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  fragColor = vec4(clamp((1.0 - exp(-color * brightness)) + (dither - 0.5) / 255.0 * min(brightness, 1.0), 0.0, 1.0), 1.0);
  float luminance = dot(fragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  fragColor.rgb = mix(vec3(luminance), fragColor.rgb, saturation);
}
