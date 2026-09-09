precision highp float;

uniform float emberSize;
uniform float sizeVariation;
uniform float direction;
uniform float wander;
uniform float fadeDuration;
uniform float hazeStrength;
uniform vec3 background;
uniform float saturation;

uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float density;
uniform float glow;
uniform float brightness;
uniform vec3 color1;
uniform vec3 color2;
varying vec2 vUv;

float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }

void main() {
  float aspect = uResolution.x / uResolution.y;
  float t = uTime * speed;
  vec3 color = background;
  float rotation = radians(direction);
  mat2 riseRotation = mat2(cos(rotation), sin(rotation), -sin(rotation), cos(rotation));
  for (int i = 0; i < 32; i++) {
    float id = float(i);
    float seed = hash(id + 1.0);
    float life = fract(seed + t * mix(0.016, 0.04, hash(id + 7.0)));
    vec2 center = vec2(0.06 + hash(id + 19.0) * 0.88, life * 1.2 - 0.1);
    center.x += wander * sin(t * 0.3 + id * 2.4 + life * 5.0);
    center = (riseRotation * ((center - 0.5) * vec2(aspect, 1.0))) / vec2(aspect, 1.0) + 0.5;
    vec2 offset = (vUv - center) * vec2(aspect, 1.0);
    float radius = emberSize * mix(0.0035, mix(0.002, 0.005, seed), sizeVariation);
    radius = max(radius, 0.7 / uResolution.y);
    float distanceSquared = dot(offset, offset);
    float core = exp(-distanceSquared / (radius * radius));
    float haloRadius = mix(0.015, 0.05, glow) * (0.6 + seed * 0.4);
    float halo = exp(-distanceSquared / (haloRadius * haloRadius)) * glow * 0.23;
    // Fade before recycling a mote, avoiding visible jumps at the wrap point.
    float envelope = smoothstep(0.0, 0.18 * fadeDuration, life) * (1.0 - smoothstep(1.0 - 0.25 * fadeDuration, 1.0, life));
    float visibility = 1.0 - smoothstep(density * 32.0 - 1.0, density * 32.0, id);
    color += mix(color1, color2, seed) * (core + halo) * envelope * visibility;
  }
  float haze = 0.5 + 0.5 * sin(vUv.x * 6.0 + sin(vUv.y * 4.0 - t * 0.15) + t * 0.12);
  color += color1 * haze * hazeStrength * (1.0 - vUv.y);
  gl_FragColor = vec4(1.0 - exp(-color * brightness), 1.0);
  float luminance = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor.rgb = mix(vec3(luminance), gl_FragColor.rgb, saturation);
}
