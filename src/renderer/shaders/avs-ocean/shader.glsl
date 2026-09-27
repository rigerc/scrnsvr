// Ported from AVS/ocean.glsl; original notices are preserved below.
precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float contrast;
uniform float brightness;
uniform float saturation;
uniform float waveHeight;
uniform float waveDensity;
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
const float waveHeight = 1.0;
const float waveDensity = 1.0;
const int palette = 0;
const vec3 shadowColor = vec3(0.019608, 0.043137, 0.086275);
const vec3 midtoneColor = vec3(0.203922, 0.490196, 0.603922);
const vec3 highlightColor = vec3(0.890196, 0.968627, 1.000000);
#endif

float scrnsvrTanh(float value) { float e = exp(clamp(2.0 * value, -40.0, 40.0)); return (e - 1.0) / (e + 1.0); }
vec2 scrnsvrTanh(vec2 value) { return vec2(scrnsvrTanh(value.x), scrnsvrTanh(value.y)); }
vec3 scrnsvrTanh(vec3 value) { return vec3(scrnsvrTanh(value.x), scrnsvrTanh(value.y), scrnsvrTanh(value.z)); }
vec4 scrnsvrTanh(vec4 value) { return vec4(scrnsvrTanh(value.x), scrnsvrTanh(value.y), scrnsvrTanh(value.z), scrnsvrTanh(value.w)); }

const float oceanBrightness = 1.0;
const float colorBase = 1.5;
const float colorSpeed = 0.5;
const vec3 rgbPhase = vec3(0.0, 0.0, 0.5);
const float colorWave = 14.0;
const vec3 colorDot = vec3(1.0, -2.0, 0.0);
const float waveSteps = 4.0;
const float waveFreq = 6.0;
const float waveAmp = 0.6;
const float waveExp = 2.8;
const vec3 waveVel = vec3(0.25);
const float passthrough = 1.25;
const float softness = 0.0009;
const float steps = 125.0;
const float skyBright = 0.0;
const float fov = 1.0;

void upstreamImage(out vec4 scrnsvrResult, in vec2 scrnsvrCoord) {
    vec2 fragCoord = scrnsvrCoord;
    float z = 0.0;
    float d = 0.0;
    float s = 0.0;
    vec3 dir = normalize(vec3(2.0 * fragCoord - uResolution, -fov * uResolution.y));
    if(dir.y > 0.0) {
        scrnsvrResult = vec4(0.0, 0.0, 0.0, 0.0);
        return;
    }
    vec3 col = vec3(0.0);
    for(float i = 0.0; i < steps; i++) {
        vec3 p = z * dir;
        float f = waveFreq * waveDensity;
        for(float j = 0.0; j < waveSteps; j++) {
            p += waveAmp * waveHeight * sin(p * f - waveVel * uTime * speed).yzx / f;
            f *= waveExp;
        }
        s = 0.25 - abs(p.y);
        d = softness + max(s, -s * passthrough) / 4.0;
        z += d;
        float phase = colorWave * s + sin(length(p.xy) * 2.0 + colorSpeed * uTime * speed);
        col += (cos(phase - rgbPhase) + colorBase) / d;
    }
    col *= softness / steps * oceanBrightness;
    vec3 squared = col * col;
    vec3 exp2 = exp(2.0 * squared);
    vec3 tanhCol = (exp2 - 1.0) / (exp2 + 1.0);
    tanhCol = vec3(0.0, tanhCol.g, 0.0);
    scrnsvrResult = vec4(tanhCol, 1.0);
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
