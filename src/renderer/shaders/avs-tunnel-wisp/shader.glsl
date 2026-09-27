// Ported from AVS/tunnelwisp.glsl; original notices are preserved below.
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

// CC0: Trailing the Twinkling Tunnelwisp
// Converted to standalone GLSL for use with shader.cpp host

float g(vec4 p,float s) {
  return abs(dot(sin(p*=s),cos(p.zxwy))-1.)/s;
}

void effectImage(out vec4 O, vec2 C) {
  float d = 0.0, z = 0.0, s = 0.0, T = uTime * speed;
  vec4 o = vec4(0.0), q = vec4(0.0), p = vec4(0.0), U = vec4(2,1,0,3);
  vec2 r = uResolution;
  for (int iteration = 0; iteration < 49; ++iteration) {
    z += d + 1.5E-3;
    q = vec4(normalize(vec3(C - 0.5 * r, r.y)) * z, 0.2);
    q.z += T / 3E1;
    s = q.y + 0.1;
    q.y = abs(s);
    p = q;
    p.y -= 0.11;
    p.xy *= mat2(cos(11.0 * U.zywz - 2.0 * p.z));
    p.y -= 0.2;
    d = abs(g(p, 8.0) - g(p, 24.0)) / 4.0;
    p = 1.0 + cos(0.7 * U + 5.0 * q.z);
    o += (s > 0.0 ? 1.0 : 0.1) * p.w * p / max(s > 0.0 ? d : d*d*d, 5E-4);
  }

  vec2 dq = abs(q.xy) - vec2(0.06, 0.15);
  float doorDist = length(max(dq, 0.0)) + min(max(dq.x, dq.y), 0.0);
  o += (1.4 + sin(T) * sin(1.7 * T) * sin(2.3 * T))
       * 1E2 * U / max(doorDist + 0.02, 0.02);
  O = scrnsvrTanh(o / 1E5);
}

void upstreamImage(out vec4 scrnsvrResult, in vec2 scrnsvrCoord) {
    // Scanline skip: every other row black, saves 50% GPU
    vec2 fc = scrnsvrCoord;
    if (mod(floor(fc.y), 2.0) < 1.0) {
        scrnsvrResult = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }
    vec4 fragColor;
    effectImage(fragColor, fc);
    scrnsvrResult = fragColor;
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
