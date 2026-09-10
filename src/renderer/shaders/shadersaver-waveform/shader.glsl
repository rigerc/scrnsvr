// Ported from ShaderSaver/shader7.txt; original notices are preserved below.
precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float contrast;
uniform float brightness;
uniform float saturation;
#define iTime (uTime * speed)
#define iResolution (vec3(uResolution, 1.0))

float scrnsvrTanh(float value) { float e = exp(clamp(2.0 * value, -40.0, 40.0)); return (e - 1.0) / (e + 1.0); }
vec2 scrnsvrTanh(vec2 value) { return vec2(scrnsvrTanh(value.x), scrnsvrTanh(value.y)); }
vec3 scrnsvrTanh(vec3 value) { return vec3(scrnsvrTanh(value.x), scrnsvrTanh(value.y), scrnsvrTanh(value.z)); }
vec4 scrnsvrTanh(vec4 value) { return vec4(scrnsvrTanh(value.x), scrnsvrTanh(value.y), scrnsvrTanh(value.z), scrnsvrTanh(value.w)); }

/*
    "Waveform" by @XorDev

    I wish Soundcloud worked on ShaderToy again
*/
void mainImage(out vec4 O, vec2 I) {
  float z = 0.0;
  O = vec4(0.0);
  for (int step = 0; step < 90; ++step) {
    vec3 p = z * normalize(vec3(I + I, 0.0) - iResolution.xyy);
    p += 1.0;
    float r = max(-p, 0.0).y;
    p.y += r + r;
    float d = 1.0;
    for (int octave = 0; octave < 5; ++octave) {
      p.y += cos(p * d + 2.0 * iTime * cos(d) + z).x / d;
      d += d;
    }
    d = (0.1 * r + abs(p.y - 1.0) / (1.0 + r + r + r*r) + max(p.z + 3.0, -d * 0.1)) / 8.0;
    // The signed estimate can reach zero at the bright surface. Keep the
    // march moving forward and the reciprocal light contribution finite.
    d = max(d, 1e-4);
    z += d;
    O += (cos(z * 0.5 + iTime + vec4(0,2,4,3)) + 1.3) / d / max(z, 1e-4);
  }
  O = scrnsvrTanh(O / 9e2);
}

void main() {
  vec4 importedColor = vec4(0.0);
  mainImage(importedColor, gl_FragCoord.xy);
  gl_FragColor = importedColor;
  vec3 color = (gl_FragColor.rgb - 0.5) * contrast + 0.5;
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(mix(vec3(luminance), color, saturation) * brightness, 1.0);
}
