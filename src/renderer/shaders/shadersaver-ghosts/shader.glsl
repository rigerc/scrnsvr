// Ported from ShaderSaver/shader6.txt; original notices are preserved below.
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
    "Ghosts" by @XorDev

    More fun with Turbulence in 3D. Also see

    3D Fire:
    https://www.shadertoy.com/view/3XXSWS
    Ether:
    https://www.shadertoy.com/view/t3XXWj
    Angel:
    https://www.shadertoy.com/view/3XXSDB

    Tweet version:
    https://x.com/XorDev/status/1915763936957264357
*/

void upstreamImage(out vec4 O, vec2 I) {
  float t = uTime * speed, z = 0.0;
  O = vec4(0.0);
  for (int step = 0; step < 100; ++step) {
    vec3 p = z * normalize(vec3(I + I, 0.0) - vec3(uResolution, uResolution.y));
    p.xy *= mat2(cos((z + t) * 0.1 + vec4(0, 33, 11, 0)));
    p.z -= 5.0 * t;
    float d = 1.0;
    for (int octave = 0; octave < 7; ++octave) {
      p += cos(p.yzx * d + t) / d;
      d /= 0.7;
    }
    d = 0.02 + abs(2.0 - dot(cos(p), sin(p.yzx * 0.6))) / 8.0;
    z += d;
    O += vec4(z / 7.0, 2, 3, 1) / d;
  }
  O = scrnsvrTanh(O * O / 1e7);
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
