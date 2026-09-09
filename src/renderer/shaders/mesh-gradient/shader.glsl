precision highp float;

uniform float movementRange;
uniform float spreadX;
uniform float spreadY;
uniform float warpFrequency;
uniform float influence1;
uniform float influence2;
uniform float influence3;
uniform float influence4;
uniform float brightness;
uniform float saturation;

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
    sin(vUv.y * 5.0 * warpFrequency + t * 0.37),
    cos(vUv.x * 4.0 * warpFrequency - t * 0.29)
  );
  p = (p - 0.5) / vec2(spreadX, spreadY) + 0.5;
  vec2 a = vec2(0.2, 0.2) + movementRange * vec2(sin(t * 0.43), cos(t * 0.37));
  vec2 b = vec2(0.8, 0.25) + movementRange * vec2(cos(t * 0.31), sin(t * 0.41));
  vec2 c = vec2(0.25, 0.8) + movementRange * vec2(cos(t * 0.39), sin(t * 0.33));
  vec2 d = vec2(0.8, 0.8) + movementRange * vec2(sin(t * 0.35), cos(t * 0.45));
  vec4 distances = vec4(dot(p-a, p-a), dot(p-b, p-b), dot(p-c, p-c), dot(p-d, p-d));
  // Subtract the nearest distance so weights remain stable even at low blend.
  distances -= min(min(distances.x, distances.y), min(distances.z, distances.w));
  vec4 weights = exp(-distances * mix(24.0, 3.0, blend)) * vec4(influence1, influence2, influence3, influence4);
  vec3 color = (color1 * weights.x + color2 * weights.y + color3 * weights.z + color4 * weights.w)
    / dot(weights, vec4(1.0));
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  gl_FragColor = vec4(clamp(color + (dither - 0.5) / 255.0, 0.0, 1.0), 1.0);
  gl_FragColor.rgb *= brightness;
  float luminance = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor.rgb = mix(vec3(luminance), gl_FragColor.rgb, saturation);
}
