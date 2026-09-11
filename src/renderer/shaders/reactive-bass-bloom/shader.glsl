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

float density(vec3 p, float t, float fullness) {
  vec3 q = p;
  q += 0.22 * sin(p.yzx * 2.7 + vec3(t * 0.45, -t * 0.32, t * 0.27));
  q += 0.09 * sin(q.zxy * 5.3 + vec3(1.1, 2.3, 0.7) - t * 0.18);
  float body = 1.0 - smoothstep(0.45, 1.05 + fullness, length(q * vec3(1.12, 0.95, 1.15)));
  float folds = 0.65 + 0.35 * sin(q.x * 5.0 + q.y * 3.0 + sin(q.z * 4.0 + t * 0.3));
  return body * folds;
}

void main() {
  vec2 p = (2.0 * gl_FragCoord.xy - uResolution.xy) / min(uResolution.x, uResolution.y) * scale;
  float t = uTime * speed * 0.13;
  vec4 a = 1.0 - exp(-max(uAudio, vec4(0.0)) * sensitivity * 1.4);
  p /= 1.0 + a.y * 0.08;
  t += a.z * 0.4;
  p -= vec2(0.12 + sin(t * 0.35) * 0.06, 0.05 * cos(t * 0.4));
  p = mat2(0.94, -0.342, 0.342, 0.94) * p;
  vec3 color = background;
  float transmission = 1.0;
  // Fixed, inexpensive volume slices; light is scattered through the material.
  for (int i = 0; i < 14; i++) {
    float z = 1.3 - float(i) * 0.2;
    vec3 q = vec3(p, z);
    float d = density(q, t, a.y * 0.12);
    float shade = clamp((d - density(q + vec3(-0.18, 0.24, 0.18), t, a.y * 0.12)) * 2.4 + 0.46, 0.1, 1.0);
    vec3 tint = mix(color1, color2, smoothstep(-0.5, 0.9, q.y - q.x * 0.5 + a.z * 0.12));
    vec3 light = tint * (0.3 + shade * 0.85 + a.x * 0.25 + a.w * 0.08);
    float opacity = 1.0 - exp(-d * 0.42);
    color += transmission * opacity * light;
    transmission *= 1.0 - opacity;
  }
  float grain = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;
  color += grain / 255.0;
  color = mix(vec3(dot(color, vec3(0.299, 0.587, 0.114))), color, saturation);
  gl_FragColor = vec4(clamp(color * brightness, 0.0, 1.0), 1.0);
}
