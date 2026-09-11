precision highp float;
uniform float uTime;
uniform float speed;
uniform float sensitivity;
uniform float scale;
uniform float brightness;
uniform float saturation;
uniform vec3 color1;
uniform vec3 color2;
uniform vec3 background;
uniform vec2 uResolution;
uniform vec4 uAudio;

float pool(vec2 p, vec2 center, vec2 stretch) {
  vec2 q = (p - center) / stretch;
  return exp(-dot(q, q) * 2.0);
}

void main() {
  // Use the short edge so the composition remains visible in portrait layouts.
  vec2 p = (2.0 * gl_FragCoord.xy - uResolution.xy) / min(uResolution.x, uResolution.y) * scale;
  float t = uTime * speed * 0.12;
  vec4 a = 1.0 - exp(-max(uAudio, vec4(0.0)) * sensitivity * 1.4);
  vec2 drift = vec2(sin(t * 0.71), cos(t * 0.53)) * 0.18 + vec2(a.y * 0.16, a.z * 0.12);
  p += vec2(sin(p.y * 1.2 + t) * 0.08, sin(p.x * 1.4 - t * 0.6) * 0.06);
  float warm = pool(p, vec2(-0.42, 0.2) + drift, vec2(0.72, 0.93) * (1.0 + a.y * 0.32));
  float cool = pool(p, vec2(0.5, -0.27) - drift * 0.8, vec2(0.86, 0.64));
  float ivory = pool(p, vec2(-0.16, 0.48) + drift * 0.5, vec2(0.45, 0.57));
  float spill = pool(p, vec2(0.12, 0.0), vec2(1.6, 1.3));
  vec3 color = background + color1 * warm * (0.4 + a.x * 0.28);
  color += color2 * cool * (0.36 + a.z * 0.18);
  color += mix(color1, vec3(0.96, 0.93, 0.85), 0.55) * ivory * (0.22 + a.w * 0.08);
  color += mix(color1, color2, 0.5) * spill * 0.035;
  // Static subpixel dither prevents banding without introducing animated sparkle.
  float grain = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;
  color += grain / 255.0;
  color = mix(vec3(dot(color, vec3(0.299, 0.587, 0.114))), color, saturation);
  gl_FragColor = vec4(clamp(color * brightness, 0.0, 1.0), 1.0);
}
