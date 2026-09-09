precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float width;
uniform float sway;
uniform float brightness;
uniform vec3 color1;
uniform vec3 color2;
varying vec2 vUv;

void main() {
  vec2 p = vUv - 0.5;
  float aspect = uResolution.x / uResolution.y;
  float x = p.x * aspect;
  float t = uTime * speed;
  vec3 color = vec3(0.009, 0.006, 0.025);
  for (int i = 0; i < 5; i++) {
    float layer = float(i);
    float phase = x * 1.8 + layer * 0.65;
    float center = (layer - 2.0) * 0.105
      + sway * 0.21 * sin(phase + t * 0.32)
      + 0.055 * cos(x * 3.1 - t * 0.23 + layer);
    float halfWidth = mix(0.012, 0.095, width) * (0.7 + 0.3 * sin(phase - t * 0.21));
    float distance = (p.y - center) / halfWidth;
    float body = exp(-distance * distance * 1.8);
    float edgeDistance = (distance - 0.65) * 5.0;
    float edge = exp(-edgeDistance * edgeDistance);
    float sheen = 0.55 + 0.45 * sin(phase * 1.3 - t * 0.19 + layer);
    vec3 tint = mix(color1, color2, 0.5 + 0.5 * sin(layer * 0.9 + x * 0.6 + t * 0.12));
    color += tint * (body * 0.36 + edge * 0.15) * sheen;
  }
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  gl_FragColor = vec4(clamp((1.0 - exp(-color * brightness)) + (dither - 0.5) / 255.0 * min(brightness, 1.0), 0.0, 1.0), 1.0);
}
