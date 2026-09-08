precision highp float;

uniform float uTime;
uniform float speed;
uniform float waves;
uniform float spread;
uniform float brightness;
uniform vec3 color1;
uniform vec3 color2;
varying vec2 vUv;

void main() {
  vec2 p = vUv;
  float t = uTime * speed;
  vec3 color = mix(vec3(0.008, 0.015, 0.05), vec3(0.035, 0.055, 0.13), p.y);
  for (int i = 0; i < 3; i++) {
    float layer = float(i);
    float phase = p.x * waves * 3.0 + layer * 1.8;
    float center = 0.3 + layer * 0.17
      + 0.12 * sin(phase + t * 0.35)
      + 0.05 * sin(phase * 2.3 - t * 0.27);
    float distance = p.y - center;
    // A narrow lower edge opens into a broad translucent curtain above it.
    float width = mix(0.025, 0.12, spread) * (1.0 + 2.5 * smoothstep(-0.02, 0.2, distance));
    float curtain = exp(-distance * distance / (width * width));
    float folds = 0.72 + 0.28 * sin(phase * 5.0 + sin(phase * 1.7 + t * 0.2) - t * 0.4);
    vec3 tint = mix(color1, color2, 0.5 + 0.5 * sin(p.x * 2.5 + layer * 1.6 + t * 0.15));
    color += tint * curtain * folds * 0.5 * brightness;
  }
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  gl_FragColor = vec4(clamp(color + (dither - 0.5) / 255.0, 0.0, 1.0), 1.0);
}
