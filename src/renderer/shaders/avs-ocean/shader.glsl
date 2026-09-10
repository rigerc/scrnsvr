// Ported from AVS/ocean.glsl; original notices are preserved below.
precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float contrast;
uniform float brightness;
uniform float saturation;
#define time (uTime * speed)
#define resolution (uResolution)

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

void scrnsvrImportedMain() {
    vec2 fragCoord = gl_FragCoord.xy;
    float z = 0.0;
    float d = 0.0;
    float s = 0.0;
    vec3 dir = normalize(vec3(2.0 * fragCoord - resolution.xy, -fov * resolution.y));
    if(dir.y > 0.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
        return;
    }
    vec3 col = vec3(0.0);
    for(float i = 0.0; i < steps; i++) {
        vec3 p = z * dir;
        float f = waveFreq;
        for(float j = 0.0; j < waveSteps; j++) {
            p += waveAmp * sin(p * f - waveVel * time).yzx / f;
            f *= waveExp;
        }
        s = 0.25 - abs(p.y);
        d = softness + max(s, -s * passthrough) / 4.0;
        z += d;
        float phase = colorWave * s + sin(length(p.xy) * 2.0 + colorSpeed * time);
        col += (cos(phase - rgbPhase) + colorBase) / d;
    }
    col *= softness / steps * oceanBrightness;
    vec3 squared = col * col;
    vec3 exp2 = exp(2.0 * squared);
    vec3 tanhCol = (exp2 - 1.0) / (exp2 + 1.0);
    tanhCol = vec3(0.0, tanhCol.g, 0.0);
    gl_FragColor = vec4(tanhCol, 1.0);
}

void main() {
  scrnsvrImportedMain();
  vec3 color = (gl_FragColor.rgb - 0.5) * contrast + 0.5;
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(mix(vec3(luminance), color, saturation) * brightness, 1.0);
}
