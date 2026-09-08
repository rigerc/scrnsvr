precision highp float;

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
  vec2 a = vec2(0.38 * cos(t), 0.28 * sin(t * 1.17));
  vec2 b = vec2(0.38 * cos(t + 3.14159), 0.28 * sin(t * 1.17 + 2.4));
  float count = float(rings);
  float ra = abs(fract(length(uv - a) * count * 0.12 - t * 0.15) - 0.5);
  float rb = abs(fract(length(uv - b) * count * 0.12 + t * 0.12) - 0.5);
  float lines = 1.0 - smoothstep(0.02, max(0.021, softness), min(ra, rb));
  float crossing = 1.0 - smoothstep(0.0, softness * 1.8, abs(ra - rb));
  float intensity = clamp(lines * 0.8 + crossing * 0.55, 0.0, 1.0);
  if (invert) intensity = 1.0 - intensity;
  vec3 background = vec3(0.008, 0.012, 0.028);
  gl_FragColor = vec4(mix(background, color, intensity), 1.0);
}
