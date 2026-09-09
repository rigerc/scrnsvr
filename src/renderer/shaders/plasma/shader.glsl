precision highp float;

uniform float direction;
uniform float distortion;
uniform float radialStrength;
uniform float paletteOffset;
uniform vec3 color1;
uniform vec3 color2;
uniform vec3 color3;
uniform float brightness;
uniform float saturation;

uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float scale;
uniform float contrast;
uniform int palette;

vec3 colors(float value) {
  value += paletteOffset;
  if (palette == 3) {
    float position = 0.5 - 0.5 * cos(value * 3.14159265);
    return mix(mix(color1, color2, smoothstep(0.0, 0.5, position)), color3, smoothstep(0.5, 1.0, position));
  }
  if (palette == 1) {
    return 0.52 + 0.48 * cos(6.28318 * (value + vec3(0.02, 0.16, 0.34)));
  }
  if (palette == 2) {
    return 0.48 + 0.45 * cos(6.28318 * (value + vec3(0.55, 0.72, 0.88)));
  }
  return 0.5 + 0.5 * cos(6.28318 * (value + vec3(0.0, 0.33, 0.67)));
}

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - uResolution.xy) / min(uResolution.x, uResolution.y);
  float rotation = radians(direction);
  uv = mat2(cos(rotation), sin(rotation), -sin(rotation), cos(rotation)) * uv;
  float t = uTime * speed;
  float wave = sin((uv.x + t * 0.17) * scale);
  wave += sin((uv.y - t * 0.23) * scale * 1.31);
  wave += distortion * sin((uv.x + uv.y + t * 0.11) * scale * 0.73);
  wave += radialStrength * sin(length(uv) * scale * 2.0 - t);
  float value = 0.5 + 0.5 * sin(wave * contrast);
  gl_FragColor = vec4(colors(value), 1.0);
  gl_FragColor.rgb *= brightness;
  float luminance = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor.rgb = mix(vec3(luminance), gl_FragColor.rgb, saturation);
}
