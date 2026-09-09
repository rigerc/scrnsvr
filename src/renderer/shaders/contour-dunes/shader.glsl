precision highp float;

uniform float lineThickness;
uniform float edgeSoftness;
uniform float distortion;
uniform float fineDetail;
uniform float angle;
uniform float contourIntensity;
uniform float saturation;

uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float scale;
uniform float lines;
uniform float brightness;
uniform vec3 color1;
uniform vec3 color2;
varying vec2 vUv;

void main() {
  vec2 p = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0) * scale * 3.0;
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
  gl_FragColor = vec4(clamp((1.0 - exp(-color * brightness)) + (dither - 0.5) / 255.0 * min(brightness, 1.0), 0.0, 1.0), 1.0);
  float luminance = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor.rgb = mix(vec3(luminance), gl_FragColor.rgb, saturation);
}
