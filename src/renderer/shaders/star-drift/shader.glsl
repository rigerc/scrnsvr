precision highp float;

uniform float starSize;
uniform float glowAmount;
uniform float direction;
uniform float parallax;
uniform float twinkleRate;
uniform vec3 background;
uniform float saturation;

uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float density;
uniform float twinkle;
uniform float brightness;
uniform vec3 color1;
uniform vec3 color2;
varying vec2 vUv;

vec2 hash(vec2 p) {
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
  float t = uTime * speed;
  vec3 light = vec3(0.0);
  float rotation = radians(direction);
  mat2 driftRotation = mat2(cos(rotation), sin(rotation), -sin(rotation), cos(rotation));
  for (int i = 0; i < 3; i++) {
    float layer = float(i);
    float grid = (12.0 + layer * 7.0) * density;
    vec2 q = p * grid + driftRotation * vec2(t * (0.12 + layer * 0.05 * parallax), t * 0.035) + layer * 17.3;
    vec2 cell = floor(q);
    vec2 seed = hash(cell);
    vec2 offset = fract(q) - (0.25 + seed * 0.5);
    float distance = length(offset);
    float radius = starSize * mix(0.018, 0.045, seed.x) * (1.0 - layer * 0.18);
    // A pixel-sized minimum keeps small stars stable in thumbnails and at low resolutions.
    radius = max(radius, grid / uResolution.y * 0.65);
    float core = exp(-distance * distance / (radius * radius));
    float halo = exp(-distance * distance / 0.008) * 0.12 * glowAmount;
    // Stars and halos vanish before cell edges, so scrolling never clips them.
    float glow = (core + halo) * (1.0 - smoothstep(0.16, 0.24, distance));
    float pulse = 1.0 - twinkle * (0.5 + 0.5 * sin(t * 0.5 * twinkleRate + seed.y * 6.283185));
    light += mix(color1, color2, seed.x) * glow * pulse * (0.9 - layer * 0.2);
  }
  vec3 sky = background + color1 * 0.012
    * (0.5 + 0.5 * sin(p.x * 2.0 + p.y * 3.0 + t * 0.04));
  gl_FragColor = vec4(1.0 - exp(-(sky + light) * brightness), 1.0);
  float luminance = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor.rgb = mix(vec3(luminance), gl_FragColor.rgb, saturation);
}
