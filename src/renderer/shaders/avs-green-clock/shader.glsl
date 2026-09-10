// Ported from AVS/greenclock.glsl; original notices are preserved below.
precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float contrast;
uniform float brightness;
uniform float saturation;
#define iTime (uTime * speed)
#define iResolution (vec3(uResolution, 1.0))
uniform vec4 uDate;
#define iDate (vec4(uDate.xyz, uDate.w + uTime * speed))

float scrnsvrTanh(float value) { float e = exp(clamp(2.0 * value, -40.0, 40.0)); return (e - 1.0) / (e + 1.0); }
vec2 scrnsvrTanh(vec2 value) { return vec2(scrnsvrTanh(value.x), scrnsvrTanh(value.y)); }
vec3 scrnsvrTanh(vec3 value) { return vec3(scrnsvrTanh(value.x), scrnsvrTanh(value.y), scrnsvrTanh(value.z)); }
vec4 scrnsvrTanh(vec4 value) { return vec4(scrnsvrTanh(value.x), scrnsvrTanh(value.y), scrnsvrTanh(value.z), scrnsvrTanh(value.w)); }

// Green glow clock with SDF digits — 24h, stacked layout with seconds
// Converted to standalone GLSL for use with temiz.cpp host



#define TWELVE_HOUR_CLOCK   0
#define GLOWPULSE    1
#define SECONDS      1
// SHOW_GRID disabled (set to 0)

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

vec2 quintic(vec2 p) {
  return p * p * p * (10.0 + p * (-15.0 + p * 6.0));
}

float whiteNoise2x1(vec2 p) {
  float random = dot(p, vec2(12., 78.));
  random = sin(random);
  random = random * 43758.5453;
  random = fract(random);
  return random;
}

float noise(vec2 uv) {
  vec2 gridUv = fract(uv);
  vec2 gridId = floor(uv);

  gridUv = quintic(gridUv);

  float botLeft = whiteNoise2x1(gridId);
  float botRight = whiteNoise2x1(gridId + vec2(1.0, 0.0));
  float b = mix(botLeft, botRight, gridUv.x);

  float topLeft = whiteNoise2x1(gridId + vec2(0.0, 1.0));
  float topRight = whiteNoise2x1(gridId + vec2(1.0, 1.0));
  float t = mix(topLeft, topRight, gridUv.x);

  return mix(b, t, gridUv.y);
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

float numberLength(float n)
{
    return floor(max(log(n) / log(10.0), 0.0) + 1.0) + 2.0;
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 aspect = iResolution.xy / iResolution.y;
    vec2 uv = (fragCoord.xy / iResolution.y - aspect/2.0) * 2.5;

    float secs = iDate.w;
    int hour = int(secs/3600.);
#if TWELVE_HOUR_CLOCK
    if( hour > 12 ) hour -= 12;
    if( hour == 0 ) hour = 12;
#endif
    int minute = int(mod(secs/60.,60.));

    float nsize = numberLength(999999.);
    vec2 pos = vec2((-digitSize.x*1.1),digitSize.y/1.4);

    vec2 basepos = pos;
    pos.y = basepos.y;
    float dist = 1e6;
    dist = min(dist, dfNumberInt(pos, hour, uv));

    pos.y -= 0.38;
    dist = min(dist, dfNumberInt(pos, minute, uv));

#if SECONDS
    int seconds = int(mod(secs,60.));
    pos.y -= 0.38;
    dist = min(dist, dfNumberInt(pos, seconds, uv));
#endif

    vec3 color = vec3(0);

    float shade = 0.006 / (dist);

    color += vec3(0.2,0.8,0.2) * shade;
#if GLOWPULSE
    color += vec3(0,1,0.2) * shade * noise((uv + vec2(iTime*0.3)) * 2.5 + .5);
#endif

    fragColor = vec4( color , 1.0 );
}

void scrnsvrImportedMain() {
    vec4 fragColor;
    mainImage(fragColor, gl_FragCoord.xy);
    gl_FragColor = fragColor;
}

void main() {
  scrnsvrImportedMain();
  vec3 color = (gl_FragColor.rgb - 0.5) * contrast + 0.5;
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(mix(vec3(luminance), color, saturation) * brightness, 1.0);
}
