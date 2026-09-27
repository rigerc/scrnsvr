// Ported from ShaderSaver/shader8.txt; original notices are preserved below.
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
uniform float dropSize;
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
const float dropSize = 1.0;
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
    "Water Ripples" by Anonymous

    Water simulation with ripples and drops
*/

//Anti-Aliasing (SSAA). Use 1.0 on slower computers
#define AA 2.

//Background gradient
vec3 background(vec3 d)
{
    float light = dot(d,sqrt(vec3(.3,.5,.2)));

    return vec3(max(light*.5+.5,.0));
}
//Smooth minimum (based off IQ's work)
float smin(float d1, float d2)
{
    const float e = -6.;
    return log(exp(d1*e)+exp(d2*e))/e;
}
//Ripple and drop distance function
float dist(vec3 p)
{
    float l = pow(dot(p.xz,p.xz),.8);
    float ripple = p.y+.8+(.4 * waveHeight)*sin(l*(3. * waveDensity)-uTime * speed+.5)/(1.+l);

    float h1 = -sin(uTime * speed);
    float h2 = cos(uTime * speed+.1);
    float drop = length(p+vec3(0,1.2,0)*h1)-.4 * dropSize;
    drop = smin(drop,length(p+vec3(.1,.8,0)*h2)-.2 * dropSize);
    return smin(ripple,drop);
}
//Typical SDF normal function
vec3 normal(vec3 p)
{
    vec2 e = vec2(1,-1)*.01;

    return normalize(dist(p-e.yxx)*e.yxx+dist(p-e.xyx)*e.xyx+
    dist(p-e.xxy)*e.xxy+dist(p-e.y)*e.y);
}
//Basic raymarcher
vec4 march(vec3 p, vec3 d)
{
    vec4 m = vec4(p,0);
    for(int i = 0; i<99; i++)
    {
        float s = dist(m.xyz);
        m += vec4(d,1)*s;

        if (s<.01 || m.w>20.) break;
    }
    return m;
}

void upstreamImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 res = uResolution;
    vec3 col = vec3(0);

    vec3 pos = vec3(.05*cos(uTime * speed),.1*sin(uTime * speed),-4);
    vec3 lig = sqrt(vec3(.3,.5,.2));

    //Sample
    for(float x = 0.;x<AA;x++)
    for(float y = 0.;y<AA;y++)
    {
        vec3 ray = normalize(vec3(fragCoord-res/2.+vec2(x,y)/AA,res.y));
        vec4 mar = march(pos,ray);
        vec3 nor = normal(mar.xyz);
        vec3 ref = refract(ray,nor,.75);
        float r = smoothstep(.8,1.,dot(reflect(ray,nor),lig));
        float l = 1.-dot(ray,nor);
        vec3 wat = background(ref)+.3*r*l*l;
        vec3 bac = background(ray)*.5+.5;

        float fade = pow(min(mar.w/20.,1.),.3);
        col += mix(wat,bac,fade);
    }
    col /= AA*AA;

    fragColor = vec4(col * col * vec3(0.72, 0.9, 1.08), 1.0);
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
