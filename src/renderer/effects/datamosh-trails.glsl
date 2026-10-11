precision highp float;
uniform sampler2D uInput;
uniform sampler2D uHistory;
uniform bool uHistoryValid;
uniform vec2 uResolution;
uniform float uTime;
uniform float uDelta;
uniform float intensity;
uniform int mode;
uniform float persistence;
uniform float decay;
uniform float displacement;
uniform int blockSize;
varying vec2 vUv;
float blockNoise(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
void main() {
  vec2 size = max(uResolution, vec2(1.0));
  vec2 edge = 0.5 / size;
  vec3 original = texture2D(uInput, clamp(vUv, edge, 1.0 - edge)).rgb;
  if (!uHistoryValid || uDelta <= 0.0) {
    gl_FragColor = vec4(original, 1.0);
    return;
  }
  float frames = uDelta * 60.0;
  vec2 movement = vec2(sin(uTime * 0.37), cos(uTime * 0.29)) * 0.3;
  if (mode == 1) {
    vec2 block = floor(vUv * size / max(float(blockSize), 1.0));
    float seed = blockNoise(block);
    // Local, slowly changing bounded block motion; never full-screen flashes.
    movement = vec2(sin(seed * 6.283185 + uTime * 0.41),
                    cos(seed * 5.71 + uTime * 0.33)) * (2.0 + seed * 6.0);
  }
  vec2 uv = vUv + movement * displacement * min(frames, 3.0) / size;
  vec3 previous = texture2D(uHistory, clamp(uv, edge, 1.0 - edge)).rgb;
  float retention = pow(max(persistence, 0.000001), frames);
  if (persistence <= 0.0) retention = 0.0;
  float brightness = pow(max(decay, 0.000001), frames);
  if (decay <= 0.0) brightness = 0.0;
  vec3 feedback = mix(original, previous * brightness, retention);
  gl_FragColor = vec4(mix(original, feedback, intensity), 1.0);
}
