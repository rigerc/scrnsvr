// Ported from ShaderSaver/shader13.txt; original notices are preserved below.
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
    "Rainbow Road" by @XorDev

    Where does it lead?

    Tweet: twitter.com/XorDev/status/1572623173920882689
    Twigl: t.co/NYTWiGpRXf

    -17 Thanks to iq
    -11 Thanks to FabriceNeyret2
*/

///Original [272 Chars]:
/**
void mainImage(out vec4 O, vec2 I)
{
    //Resolution for scaling
    vec2 r = uResolution,
    //Centered and scaled coordinates
    d,
    o;
    //Clear fragcolor
    O*=0.;

    //Render 50 lightbars
    for(float i=fract(-uTime * speed); i<25.; i+=.5)
        //Offset coordinates (center of bar)
        o = (I+I-r)/r.y*i+cos(i*vec2(.8,.5)+uTime * speed),
        o.y += 4.-i,
        //Color and fade
        O += (cos(i+vec4(0,2,4,0))+1.) / max(i*i,5.)*.1 /
        //Light using a segment SDF
             (length(o-clamp( dot(o, d= vec2(4,sin(i)*.4))/dot(d,d),-1.,1.) *d )/i + i/1e3);
}
***/

void upstreamImage(out vec4 O, vec2 I) {
  vec2 r = uResolution;
  O = vec4(0.0);
  float start = fract(-uTime * speed);
  for (int bar = 0; bar < 50; ++bar) {
    float i = start + float(bar) * 0.5;
    vec2 o = (I + I - r) / r.y * i + cos(i * vec2(0.8, 0.5) + uTime * speed);
    O += (cos(i + vec4(0,2,4,0)) + 1.0) / max(i*i, 5.0) * 0.1
      / (i / 1e3 + length(o - vec2(clamp(o.x, -4.0, 4.0), i + o.y * sin(i) * 0.1 - 4.0)) / max(i, 1e-3));
  }
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
