// Ported from AVS/glowclock.glsl; original notices are preserved below.
precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform vec4 uDate;
uniform float speed;
uniform float contrast;
uniform float brightness;
uniform float saturation;
uniform float clockSize;
uniform bool twelveHour;
uniform bool showSeconds;
uniform float glowWidth;
uniform float glowPulse;
uniform int palette;
uniform vec3 shadowColor;
uniform vec3 midtoneColor;
uniform vec3 highlightColor;
#else
#define uTime iTime
#define uResolution iResolution.xy
const vec4 uDate = vec4(2026.0, 9.0, 10.0, 46800.0);
const float speed = 1.0;
const float contrast = 1.0;
const float brightness = 1.0;
const float saturation = 1.0;
const float clockSize = 1.0;
const bool twelveHour = true;
const bool showSeconds = true;
const float glowWidth = 1.0;
const float glowPulse = 1.0;
const int palette = 0;
const vec3 shadowColor = vec3(0.019608, 0.043137, 0.086275);
const vec3 midtoneColor = vec3(0.207843, 0.811765, 0.501961);
const vec3 highlightColor = vec3(0.890196, 0.968627, 1.000000);
#endif

float scrnsvrTanh(float value) { float e = exp(clamp(2.0 * value, -40.0, 40.0)); return (e - 1.0) / (e + 1.0); }
vec2 scrnsvrTanh(vec2 value) { return vec2(scrnsvrTanh(value.x), scrnsvrTanh(value.y)); }
vec3 scrnsvrTanh(vec3 value) { return vec3(scrnsvrTanh(value.x), scrnsvrTanh(value.y), scrnsvrTanh(value.z)); }
vec4 scrnsvrTanh(vec4 value) { return vec4(scrnsvrTanh(value.x), scrnsvrTanh(value.y), scrnsvrTanh(value.z), scrnsvrTanh(value.w)); }

// Glow clock with SDF digits
// Converted to standalone GLSL for use with temiz.cpp host
// Note: uses vec4(uDate.xyz, mod(uDate.w + uTime * speed, 86400.0)).w for real time — host doesn't provide vec4(uDate.xyz, mod(uDate.w + uTime * speed, 86400.0)),
// falls back to uTime * speed-based fake clock.

#define TWELVE_HOUR_CLOCK   1
#define GLOWPULSE    1
#define SHOW_GRID

float pi = atan(1.0)*4.0;
float tau = atan(1.0)*8.0;

const float scale = 1.0 / 6.0;

vec2 digitSize = vec2(1.0,1.5) * scale;
vec2 digitSpacing = vec2(1.1,1.6) * scale;

float hash12(vec2 p)
{
    vec3 p3  = fract(vec3(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 pos) {
    vec2 i = floor(pos);
    vec2 f = fract(pos);

    float a = hash12(i);
    float b = hash12(i + vec2(1, 0));
    float c = hash12(i + vec2(0, 1));
    float d = hash12(i + vec2(1, 1));

    vec2 u = f * f * (3.0 - 2.0 * f);

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float dfLine(vec2 start, vec2 end, vec2 uv)
{
    start *= scale;
    end *= scale;

    vec2 line = end - start;
    float frac = dot(uv - start,line) / dot(line,line);
    return distance(start + line * clamp(frac, 0.0, 1.0), uv);
}

float dfCircle(vec2 origin, float radius, vec2 uv)
{
    origin *= scale;
    radius *= scale;

    return abs(length(uv - origin) - radius);
}

float dfArc(vec2 origin, float start, float sweep, float radius, vec2 uv)
{
    origin *= scale;
    radius *= scale;

    uv -= origin;
    uv *= mat2(cos(start), sin(start),-sin(start), cos(start));

    float offs = (sweep / 2.0 - pi);
    float ang = mod(atan(uv.y, uv.x) - offs, tau) + offs;
    ang = clamp(ang, min(0.0, sweep), max(0.0, sweep));

    return distance(radius * vec2(cos(ang), sin(ang)), uv);
}

float dfDigit(vec2 origin, float d, vec2 uv)
{
    uv -= origin;
    d = floor(d);
    float dist = 1e6;

    if(d == 0.0)
    {
        dist = min(dist, dfLine(vec2(1.000,1.000), vec2(1.000,0.500), uv));
        dist = min(dist, dfLine(vec2(0.000,1.000), vec2(0.000,0.500), uv));
        dist = min(dist, dfArc(vec2(0.500,1.000),0.000, 3.142, 0.500, uv));
        dist = min(dist, dfArc(vec2(0.500,0.500),3.142, 3.142, 0.500, uv));
        return dist;
    }
    if(d == 1.0)
    {
        dist = min(dist, dfLine(vec2(0.500,1.500), vec2(0.500,0.000), uv));
        return dist;
    }
    if(d == 2.0)
    {
        dist = min(dist, dfLine(vec2(1.000,0.000), vec2(0.000,0.000), uv));
        dist = min(dist, dfLine(vec2(0.388,0.561), vec2(0.806,0.719), uv));
        dist = min(dist, dfArc(vec2(0.500,1.000),0.000, 3.142, 0.500, uv));
        dist = min(dist, dfArc(vec2(0.700,1.000),5.074, 1.209, 0.300, uv));
        dist = min(dist, dfArc(vec2(0.600,0.000),1.932, 1.209, 0.600, uv));
        return dist;
    }
    if(d == 3.0)
    {
        dist = min(dist, dfLine(vec2(0.000,1.500), vec2(1.000,1.500), uv));
        dist = min(dist, dfLine(vec2(1.000,1.500), vec2(0.500,1.000), uv));
        dist = min(dist, dfArc(vec2(0.500,0.500),3.142, 4.712, 0.500, uv));
        return dist;
    }
    if(d == 4.0)
    {
        dist = min(dist, dfLine(vec2(0.700,1.500), vec2(0.000,0.500), uv));
        dist = min(dist, dfLine(vec2(0.000,0.500), vec2(1.000,0.500), uv));
        dist = min(dist, dfLine(vec2(0.700,1.200), vec2(0.700,0.000), uv));
        return dist;
    }
    if(d == 5.0)
    {
        dist = min(dist, dfLine(vec2(1.000,1.500), vec2(0.300,1.500), uv));
        dist = min(dist, dfLine(vec2(0.300,1.500), vec2(0.200,0.900), uv));
        dist = min(dist, dfArc(vec2(0.500,0.500),3.142, 5.356, 0.500, uv));
        return dist;
    }
    if(d == 6.0)
    {
        dist = min(dist, dfLine(vec2(0.067,0.750), vec2(0.500,1.500), uv));
        dist = min(dist, dfCircle(vec2(0.500,0.500), 0.500, uv));
        return dist;
    }
    if(d == 7.0)
    {
        dist = min(dist, dfLine(vec2(0.000,1.500), vec2(1.000,1.500), uv));
        dist = min(dist, dfLine(vec2(1.000,1.500), vec2(0.500,0.000), uv));
        return dist;
    }
    if(d == 8.0)
    {
        dist = min(dist, dfCircle(vec2(0.500,0.400), 0.400, uv));
        dist = min(dist, dfCircle(vec2(0.500,1.150), 0.350, uv));
        return dist;
    }
    if(d == 9.0)
    {
        dist = min(dist, dfLine(vec2(0.933,0.750), vec2(0.500,0.000), uv));
        dist = min(dist, dfCircle(vec2(0.500,1.000), 0.500, uv));
        return dist;
    }

    return dist;
}

float dfNumberInt(vec2 origin, int inum, vec2 uv)
{
    float num = float(inum);
    uv -= origin;
    float dist = 1e6;
    float offs = 0.0;

    for(float i = 1.0;i >= 0.0;i--)
    {
        float d = mod(num / pow(10.0,i),10.0);

        vec2 pos = digitSpacing * vec2(offs,0.0);

        dist = min(dist, dfDigit(pos, d, uv));
        offs++;
    }
    return dist;
}

float dfColon(vec2 origin, vec2 uv) {
    uv -= origin;
    float dist = 1e6;
    float offs = 0.0;

    dist = min(dist, dfCircle(vec2(offs+0.9,0.9)*1.1, 0.04,uv));
    dist = min(dist, dfCircle(vec2(offs+0.9,0.4)*1.1, 0.04,uv));
    return dist;
}

float numberLength(float n)
{
    return floor(max(log(n) / log(10.0), 0.0) + 1.0) + 2.0;
}

void effectImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 aspect = uResolution / uResolution.y;
    vec2 uv = (fragCoord.xy / uResolution.y - aspect/2.0) * 2.8 / clockSize;
    uv.y -= 0.12;

    float secs = vec4(uDate.xyz, mod(uDate.w + uTime * speed, 86400.0)).w;
    int hour = int(floor(secs / 3600.0));
if (twelveHour) {
if( hour > 12 ) hour -= 12;
    if( hour == 0 ) hour = 12;
}
    int minute = int(mod(floor(secs / 60.0), 60.0));
    int sec = int(mod(secs, 60.0));

    vec2 pos = vec2(-0.55, 0.0);
    float dist = 1e6;

    // HH
    dist = min(dist, dfNumberInt(pos, hour, uv));

    pos.x += 0.23;
    dist = min(dist, dfColon(pos, uv));

    // MM
    pos.x += 0.21;
    dist = min(dist, dfNumberInt(pos, minute, uv));

    pos.x += 0.23;
    if (showSeconds) dist = min(dist, dfColon(pos, uv));

    // SS
    pos.x += 0.21;
    if (showSeconds) dist = min(dist, dfNumberInt(pos, sec, uv));

    vec3 color = vec3(0);

    float shade = 0.0;

    shade = 0.004 * glowWidth / (dist);

    color += vec3(1,0.2,0) * shade;
#if GLOWPULSE
    color += vec3(1,0.2,0) * shade * noise((uv + vec2(uTime * speed*.5)) * 2.5 + .5) * glowPulse;
#endif

    #ifdef SHOW_GRID
    float grid = 0.5-max(abs(mod(uv.x*64.0,1.0)-0.5), abs(mod(uv.y*64.0,1.0)-0.5));

    color *= 0.25+vec3(smoothstep(0.0,64.0 / uResolution.y,grid))*0.75;
    #endif

    fragColor = vec4( color , 1.0 );
}

void upstreamImage(out vec4 scrnsvrResult, in vec2 scrnsvrCoord) {
    vec4 fragColor;
    effectImage(fragColor, scrnsvrCoord);
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
