precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float size;
uniform float softness;
uniform int count;
uniform vec3 color1;
uniform vec3 color2;
uniform vec3 color3;
uniform vec3 background;
varying vec2 vUv;

void main() {
  vec2 aspect = uResolution / min(uResolution.x, uResolution.y);
  vec2 p = (vUv - 0.5) * aspect;
  float t = uTime * speed;
  float field = 0.0;
  vec3 pigment = vec3(0.0);
  // Fixed loop bounds also compile on WebGL 1 implementations.
  for (int i = 0; i < 8; i++) {
    if (i < count) {
      float index = float(i);
      float phase = index * 2.399963;
      vec2 center = aspect * vec2(
        0.34 * sin(t * (0.23 + index * 0.017) + phase),
        0.32 * cos(t * (0.29 + index * 0.013) + phase * 1.3)
      );
      float radius = size * (0.85 + 0.15 * sin(t * 0.3 + phase));
      vec2 delta = p - center;
      float influence = radius * radius / max(dot(delta, delta), 0.0001);
      float tint = mod(index, 3.0);
      vec3 blobColor = tint < 0.5 ? color1 : (tint < 1.5 ? color2 : color3);
      pigment += blobColor * influence;
      field += influence;
    }
  }
  vec3 color = pigment / max(field, 0.0001);
  float edge = mix(0.04, 0.7, softness);
  float body = smoothstep(1.0 - edge, 1.0 + edge, field);
  float halo = 0.16 * smoothstep(0.05, 1.0, field);
  color = mix(background, color, clamp(body + halo * (1.0 - body), 0.0, 1.0));
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  gl_FragColor = vec4(clamp(color + (dither - 0.5) / 255.0, 0.0, 1.0), 1.0);
}
