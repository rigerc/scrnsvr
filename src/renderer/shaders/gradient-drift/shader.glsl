precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float scale;
uniform float warp;
uniform vec3 shadow;
uniform vec3 midtone;
uniform vec3 highlight;
varying vec2 vUv;

void main() {
  // UVs stay independent of pixel density; preserve shapes at any aspect ratio.
  vec2 p = (vUv - 0.5) * uResolution / min(uResolution.x, uResolution.y);
  float t = uTime * speed;
  vec2 direction = vec2(cos(t * 0.13 + 0.6), sin(t * 0.13 + 0.6));
  float bend = sin(p.y * 2.4 + t * 0.4) * cos(p.x * 1.8 - t * 0.3);
  float phase = dot(p, direction) * scale * 2.7 + bend * warp + t * 0.25;
  float gradient = 0.5 + 0.5 * sin(phase);
  vec3 color = mix(shadow, midtone, smoothstep(0.0, 0.55, gradient));
  color = mix(color, highlight, smoothstep(0.45, 1.0, gradient));
  // Static sub-byte dithering keeps broad gradients smooth without flicker.
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  gl_FragColor = vec4(clamp(color + (dither - 0.5) / 255.0, 0.0, 1.0), 1.0);
}
