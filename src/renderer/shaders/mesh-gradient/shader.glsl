precision highp float;

uniform float uTime;
uniform float speed;
uniform float blend;
uniform float warp;
uniform vec3 color1;
uniform vec3 color2;
uniform vec3 color3;
uniform vec3 color4;
varying vec2 vUv;

void main() {
  float t = uTime * speed;
  // Normalized coordinates let the mesh fill both portrait and wide displays.
  vec2 p = vUv + warp * 0.16 * vec2(
    sin(vUv.y * 5.0 + t * 0.37),
    cos(vUv.x * 4.0 - t * 0.29)
  );
  vec2 a = vec2(0.2, 0.2) + 0.18 * vec2(sin(t * 0.43), cos(t * 0.37));
  vec2 b = vec2(0.8, 0.25) + 0.18 * vec2(cos(t * 0.31), sin(t * 0.41));
  vec2 c = vec2(0.25, 0.8) + 0.18 * vec2(cos(t * 0.39), sin(t * 0.33));
  vec2 d = vec2(0.8, 0.8) + 0.18 * vec2(sin(t * 0.35), cos(t * 0.45));
  vec4 distances = vec4(dot(p-a, p-a), dot(p-b, p-b), dot(p-c, p-c), dot(p-d, p-d));
  // Subtract the nearest distance so weights remain stable even at low blend.
  distances -= min(min(distances.x, distances.y), min(distances.z, distances.w));
  vec4 weights = exp(-distances * mix(24.0, 3.0, blend));
  vec3 color = (color1 * weights.x + color2 * weights.y + color3 * weights.z + color4 * weights.w)
    / dot(weights, vec4(1.0));
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  gl_FragColor = vec4(clamp(color + (dither - 0.5) / 255.0, 0.0, 1.0), 1.0);
}
