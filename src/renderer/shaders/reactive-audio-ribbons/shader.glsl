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

void main() {
  vec2 p = (2.0 * gl_FragCoord.xy - uResolution.xy) / min(uResolution.x, uResolution.y) * scale;
  float t = uTime * speed * 0.1;
  vec4 a = 1.0 - exp(-max(uAudio, vec4(0.0)) * sensitivity * 1.4);
  float horizon = p.y + 0.14 + 0.025 * sin(t * 0.6) + a.y * 0.16;
  float lateral = exp(-pow((p.x - 0.3 * sin(t * 0.4)) * 0.43, 2.0));
  float glow = exp(-pow(horizon / 0.3, 2.0)) * lateral;
  float sky = exp(-pow((horizon - 0.4) / 0.65, 2.0));
  vec3 color = background + color1 * sky * (0.13 + a.z * 0.12);
  color = mix(color, color2 * (0.6 + a.x * 0.24), glow * 0.65);
  // Broad, overlapping silhouettes fade into haze at different distances.
  for (int i = 0; i < 5; i++) {
    float k = float(i);
    float edge = -0.19 - k * 0.16 - a.y * (0.025 + k * 0.012);
    edge += sin(p.x * (0.62 + k * 0.13) + t * (0.25 + k * 0.05) + k * 1.8) * (0.055 + k * 0.025);
    edge += sin(p.x * 1.3 - t * 0.16 + k) * 0.018;
    float veil = 1.0 - smoothstep(edge - 0.08, edge + 0.07 + a.z * 0.02, p.y);
    vec3 tint = mix(color1 * 0.3, background * 0.7, k / 4.0);
    color = mix(color, tint, veil * (0.48 + k * 0.08));
  }
  float mist = exp(-pow((horizon + 0.08 + 0.035 * sin(p.x * 1.8 + t * 0.4)) / 0.11, 2.0));
  color += color2 * mist * lateral * (0.035 + a.w * 0.08);
  float grain = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;
  color += grain / 255.0;
  color = mix(vec3(dot(color, vec3(0.299, 0.587, 0.114))), color, saturation);
  gl_FragColor = vec4(clamp(color * brightness, 0.0, 1.0), 1.0);
}
