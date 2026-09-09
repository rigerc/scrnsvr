precision highp float;

uniform int layers;
uniform float distortion;
uniform float complexity;
uniform float direction;
uniform float depthShading;
uniform float saturation;

uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float scale;
uniform float focus;
uniform float brightness;
uniform vec3 color1;
uniform vec3 color2;
varying vec2 vUv;

void main() {
  vec2 p = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0) * scale * 6.0;
  float rotation = radians(direction);
  p = mat2(cos(rotation), sin(rotation), -sin(rotation), cos(rotation)) * p;
  float t = uTime * speed;
  vec2 q = p + vec2(sin(p.y * 0.8 + t * 0.31), cos(p.x * 0.7 - t * 0.27)) * distortion;
  float light = 0.0;
  for (int i = 0; i < 4; i++) {
    if (i >= layers) continue;
    float layer = float(i);
    vec2 r = mat2(0.8, -0.6, 0.6, 0.8) * q;
    q = r + vec2(1.7, 2.3);
    float wave = sin(q.x * 1.6 + t * 0.4 + layer)
      + sin(q.y * 1.5 - t * 0.35)
      + complexity * sin((q.x + q.y) * 1.2 + t * 0.22);
    light += exp(-abs(wave) * mix(3.0, 9.0, focus)) / float(layers);
  }
  float depth = 0.75 + 0.25 * depthShading * sin(p.x * 0.35 + p.y * 0.4 + t * 0.15);
  vec3 color = color1 * depth + color2 * light * 0.85;
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  gl_FragColor = vec4(clamp((1.0 - exp(-color * brightness)) + (dither - 0.5) / 255.0 * min(brightness, 1.0), 0.0, 1.0), 1.0);
  float luminance = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor.rgb = mix(vec3(luminance), gl_FragColor.rgb, saturation);
}
