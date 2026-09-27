// Ported from ShaderSaver/shader7.txt; original notices are preserved below.
precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float contrast;
uniform float brightness;
uniform float saturation;
uniform int palette;
uniform vec3 shadowColor;
uniform vec3 midtoneColor;
uniform vec3 highlightColor;
#else
#define uTime iTime
#define uResolution iResolution.xy
const float speed = 1.0;
const float contrast = 1.0;
const float brightness = 1.0;
const float saturation = 1.0;
const int palette = 0;
const vec3 shadowColor = vec3(0.019608, 0.043137, 0.086275);
const vec3 midtoneColor = vec3(0.203922, 0.490196, 0.603922);
const vec3 highlightColor = vec3(0.890196, 0.968627, 1.000000);
#endif

float scrnsvrTanh(float value) { float e = exp(clamp(2.0 * value, -40.0, 40.0)); return (e - 1.0) / (e + 1.0); }
vec2 scrnsvrTanh(vec2 value) { return vec2(scrnsvrTanh(value.x), scrnsvrTanh(value.y)); }
vec3 scrnsvrTanh(vec3 value) { return vec3(scrnsvrTanh(value.x), scrnsvrTanh(value.y), scrnsvrTanh(value.z)); }
vec4 scrnsvrTanh(vec4 value) { return vec4(scrnsvrTanh(value.x), scrnsvrTanh(value.y), scrnsvrTanh(value.z), scrnsvrTanh(value.w)); }

/*
    "Waveform" by @XorDev

    I wish Soundcloud worked on ShaderToy again
*/

void upstreamImage(out vec4 O, vec2 I) {
  float z = 0.0;
  O = vec4(0.0);
  for (int step = 0; step < 90; ++step) {
    vec3 p = z * normalize(vec3(I + I, 0.0) - vec3(uResolution, uResolution.y));
    p += 1.0;
    float r = max(-p, 0.0).y;
    p.y += r + r;
    float d = 1.0;
    for (int octave = 0; octave < 5; ++octave) {
      p.y += cos(p * d + 2.0 * uTime * speed * cos(d) + z).x / d;
      d += d;
    }
    d = (0.1 * r + abs(p.y - 1.0) / (1.0 + r + r + r*r) + max(p.z + 3.0, -d * 0.1)) / 8.0;
    // The signed estimate can reach zero at the bright surface. Keep the
    // march moving forward and the reciprocal light contribution finite.
    d = max(d, 1e-4);
    z += d;
    O += (cos(z * 0.5 + uTime * speed + vec4(0,2,4,3)) + 1.3) / d / max(z, 1e-4);
  }
  O = scrnsvrTanh(O / 9e2);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  upstreamImage(fragColor, fragCoord);
  if (palette == 1) {
    // Soft-compress the source range so dark, middle and bright tones all
    // contribute: a bright cloudscape must still respond to the shadow tone.
    float raw = max(fragColor.r, max(fragColor.g, fragColor.b));
    float tone = max(raw, 0.0) / (1.0 + max(raw, 0.0));
    vec3 mapped = mix(shadowColor, midtoneColor, tone);
    mapped = mix(mapped, highlightColor, tone * tone);
    fragColor.rgb = mapped + highlightColor * max(raw - 1.0, 0.0);
  }
  vec3 color = (fragColor.rgb - 0.5) * contrast + 0.5;
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  fragColor = vec4(mix(vec3(luminance), color, saturation) * brightness, 1.0);
}
