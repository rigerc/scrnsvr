precision highp float;
uniform sampler2D uInput;
uniform sampler2D uOriginal;
uniform vec2 uResolution;
uniform float intensity;
uniform int dotSize;
uniform float angle;
uniform bool invert;
varying vec2 vUv;
void main() {
  vec2 size = max(uResolution, vec2(1.0));
  vec2 edge = 0.5 / size;
  float radians = angle * 0.01745329252;
  float c = cos(radians), s = sin(radians);
  mat2 rotation = mat2(c, s, -s, c);
  vec2 screen = rotation * (vUv * size - size * 0.5);
  float spacing = max(float(dotSize), 2.0);
  vec2 cell = floor(screen / spacing) + 0.5;
  vec2 sampleUv = (mat2(c, -s, s, c) * (cell * spacing) + size * 0.5) / size;
  vec3 inkSource = texture2D(uInput, clamp(sampleUv, edge, 1.0 - edge)).rgb;
  float luma = dot(inkSource, vec3(0.2126, 0.7152, 0.0722));
  // Dot area follows ink coverage; a one-pixel feather avoids jagged tiny dots.
  float coverage = invert ? luma : 1.0 - luma;
  float radius = sqrt(clamp(coverage, 0.0, 1.0)) * 0.70710678;
  float distance = length(screen / spacing - cell);
  float feather = 0.5 / spacing;
  float dotMask = 1.0 - smoothstep(radius - feather, radius + feather, distance);
  vec3 color = vec3(invert ? dotMask : 1.0 - dotMask);
  vec3 original = texture2D(uOriginal, clamp(vUv, edge, 1.0 - edge)).rgb;
  gl_FragColor = vec4(mix(original, color, intensity), 1.0);
}
