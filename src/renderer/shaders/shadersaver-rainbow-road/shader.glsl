// Ported from ShaderSaver/shader13.txt; original notices are preserved below.
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
    "Rainbow Road" by @XorDev

    Where does it lead?

    Tweet: twitter.com/XorDev/status/1572623173920882689
    Twigl: t.co/NYTWiGpRXf

    -17 Thanks to iq
    -11 Thanks to FabriceNeyret2
*/

void mainImage(out vec4 O, vec2 I) {
  vec2 r = iResolution.xy;
  O = vec4(0.0);
  float start = fract(-iTime);
  for (int bar = 0; bar < 50; ++bar) {
    float i = start + float(bar) * 0.5;
    vec2 o = (I + I - r) / r.y * i + cos(i * vec2(0.8, 0.5) + iTime);
    O += (cos(i + vec4(0,2,4,0)) + 1.0) / max(i*i, 5.0) * 0.1
      / (i / 1e3 + length(o - vec2(clamp(o.x, -4.0, 4.0), i + o.y * sin(i) * 0.1 - 4.0)) / max(i, 1e-3));
  }
}

///Original [272 Chars]:
/**
void mainImage(out vec4 O, vec2 I)
{
    //Resolution for scaling
    vec2 r = iResolution.xy,
    //Centered and scaled coordinates
    d,
    o;
    //Clear fragcolor
    O*=0.;

    //Render 50 lightbars
    for(float i=fract(-iTime); i<25.; i+=.5)
        //Offset coordinates (center of bar)
        o = (I+I-r)/r.y*i+cos(i*vec2(.8,.5)+iTime),
        o.y += 4.-i,
        //Color and fade
        O += (cos(i+vec4(0,2,4,0))+1.) / max(i*i,5.)*.1 /
        //Light using a segment SDF
             (length(o-clamp( dot(o, d= vec2(4,sin(i)*.4))/dot(d,d),-1.,1.) *d )/i + i/1e3);
}
***/

void main() {
  vec4 importedColor = vec4(0.0);
  mainImage(importedColor, gl_FragCoord.xy);
  gl_FragColor = importedColor;
  vec3 color = (gl_FragColor.rgb - 0.5) * contrast + 0.5;
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(mix(vec3(luminance), color, saturation) * brightness, 1.0);
}
