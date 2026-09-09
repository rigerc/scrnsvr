precision highp float;

uniform float orbitRadius;
uniform float orbitStretch;
uniform float expansionRate;
uniform float lineThickness;
uniform float intersectionGlow;
uniform vec3 background;
uniform float brightness;
uniform float saturation;

uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform int rings;
uniform float softness;
uniform bool invert;
uniform vec3 color;

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - uResolution.xy) / min(uResolution.x, uResolution.y);
  float t = uTime * speed;
  vec2 a = vec2(orbitRadius * cos(t), (orbitRadius / 0.38) * 0.28 * orbitStretch * sin(t * 1.17));
  vec2 b = vec2(orbitRadius * cos(t + 3.14159), (orbitRadius / 0.38) * 0.28 * orbitStretch * sin(t * 1.17 + 2.4));
  float count = float(rings);
  float ra = abs(fract(length(uv - a) * count * 0.12 - t * 0.15 * expansionRate) - 0.5);
  float rb = abs(fract(length(uv - b) * count * 0.12 + t * 0.12 * expansionRate) - 0.5);
  float lines = 1.0 - smoothstep(lineThickness, max(lineThickness + 0.001, softness), min(ra, rb));
  float crossing = 1.0 - smoothstep(0.0, softness * 1.8, abs(ra - rb));
  float intensity = clamp(lines * 0.8 + crossing * intersectionGlow, 0.0, 1.0);
  if (invert) intensity = 1.0 - intensity;
  gl_FragColor = vec4(mix(background, color, intensity), 1.0);
  gl_FragColor.rgb *= brightness;
  float luminance = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor.rgb = mix(vec3(luminance), gl_FragColor.rgb, saturation);
}
