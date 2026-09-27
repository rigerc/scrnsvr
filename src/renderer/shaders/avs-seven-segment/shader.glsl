// Ported from AVS/7seg.glsl; original notices are preserved below.
precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float contrast;
uniform float brightness;
uniform float saturation;
uniform float clockSize;
uniform bool twelveHour;
uniform bool showSeconds;
uniform bool digitMatrix;
uniform int palette;
uniform vec3 shadowColor;
uniform vec3 midtoneColor;
uniform vec3 highlightColor;
#define iTime (uTime * speed)
#define iResolution (vec3(uResolution, 1.0))
uniform vec4 uDate;
#define iDate (vec4(uDate.xyz, mod(uDate.w + uTime * speed, 86400.0)))

float scrnsvrTanh(float value) { float e = exp(clamp(2.0 * value, -40.0, 40.0)); return (e - 1.0) / (e + 1.0); }
vec2 scrnsvrTanh(vec2 value) { return vec2(scrnsvrTanh(value.x), scrnsvrTanh(value.y)); }
vec3 scrnsvrTanh(vec3 value) { return vec3(scrnsvrTanh(value.x), scrnsvrTanh(value.y), scrnsvrTanh(value.z)); }
vec4 scrnsvrTanh(vec4 value) { return vec4(scrnsvrTanh(value.x), scrnsvrTanh(value.y), scrnsvrTanh(value.z), scrnsvrTanh(value.w)); }

// Seven-segment LED clock
// Based on cmarangu's shader: https://www.shadertoy.com/view/3dtSRj
// Converted to standalone GLSL for use with temiz.cpp host



#define showMatrix digitMatrix
bool showOff = false;

float segment(vec2 uv, bool On)
{
    if (!On && !showOff)
        return 0.0;

    float seg = (1.0-smoothstep(0.08,0.09+float(On)*0.02,abs(uv.x)))*
                (1.0-smoothstep(0.46,0.47+float(On)*0.02,abs(uv.y)+abs(uv.x)));

    if (On)
        seg *= (1.0-length(uv*vec2(3.8,0.9)));
    else
        seg *= -(0.05+length(uv*vec2(0.2,0.1)));

    return seg;
}

float sevenSegment(vec2 uv,int num)
{
    float seg= 0.0;
    seg += segment(uv.yx+vec2(-1.0, 0.0),num!=-1 && num!=1 && num!=4                    );
    seg += segment(uv.xy+vec2(-0.5,-0.5),num!=-1 && num!=1 && num!=2 && num!=3 && num!=7);
    seg += segment(uv.xy+vec2( 0.5,-0.5),num!=-1 && num!=5 && num!=6                    );
    seg += segment(uv.yx+vec2( 0.0, 0.0),num!=-1 && num!=0 && num!=1 && num!=7          );
    seg += segment(uv.xy+vec2(-0.5, 0.5),num==0 || num==2 || num==6 || num==8           );
    seg += segment(uv.xy+vec2( 0.5, 0.5),num!=-1 && num!=2                              );
    seg += segment(uv.yx+vec2( 1.0, 0.0),num!=-1 && num!=1 && num!=4 && num!=7          );

    return seg;
}

float showNum(vec2 uv,int nr, bool zeroTrim)
{
    if (abs(uv.x)>1.5 || abs(uv.y)>1.2)
        return 0.0;

    float seg= 0.0;
    if (uv.x>0.0)
    {
        nr /= 10;
        if (nr==0 && zeroTrim)
            nr = -1;
        seg += sevenSegment(uv+vec2(-0.75,0.0),nr);
    }
    else
        seg += sevenSegment(uv+vec2( 0.75,0.0),int(mod(float(nr),10.0)));

    return seg;
}

float dots(vec2 uv)
{
    float seg = 0.0;
    uv.y -= 0.5;
    seg += (1.0-smoothstep(0.11,0.13,length(uv))) * (1.0-length(uv)*2.0);
    uv.y += 1.0;
    seg += (1.0-smoothstep(0.11,0.13,length(uv))) * (1.0-length(uv)*2.0);
    return seg;
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    // Hardcoded defaults (no keyboard input available)
    bool ampm = twelveHour;       // 24-hour mode
    bool isGreen = true;     // green color

    vec2 uv = (fragCoord.xy-0.5*iResolution.xy) /
                min(iResolution.x,iResolution.y);

    uv *= 15.0 / clockSize;

    uv.x *= -1.0;
    uv.x += uv.y/12.0;
    uv.x += 3.5;
    float seg = 0.0;

    float timeSecs = iDate.w;
    int sec = int(mod(timeSecs, 60.0));
    int minute = int(mod(floor(timeSecs / 60.0), 60.0));
    int hour = int(floor(timeSecs / 3600.0));
    if (ampm) {
        if (hour > 12) hour -= 12;
        if (hour == 0) hour = 12;
    }

    // SS (rightmost, drawn first since uv.x starts high)
    if (showSeconds) seg += showNum(uv, sec, false);

    uv.x -= 1.75;
    if (showSeconds) seg += dots(uv);

    // MM
    uv.x -= 1.75;
    seg += showNum(uv, minute, false);

    uv.x -= 1.75;
    seg += dots(uv);

    // HH (leftmost)
    uv.x -= 1.75;
    seg += showNum(uv, hour, false);

    // Matrix overlay
    if (showMatrix)
    {
        seg *= 0.8+0.2*smoothstep(0.02,0.04,mod(uv.y+uv.x,0.06025));
    }

    if (seg<0.0)
    {
        seg = -seg;
        fragColor = vec4(seg,seg,seg,1.0);
    }
    else
    {
        if (showMatrix)
        {
            if (isGreen)
                fragColor = vec4(0.0,seg,seg*0.5,1.0);
            else
                fragColor = vec4(0.0,seg*0.8,seg,1.0);
        }
        else
        {
            if (isGreen)
                fragColor = vec4(0.0,seg,0.0,1.0);
            else
                fragColor = vec4(seg,0.0,0.0,1.0);
        }
    }
}

void scrnsvrImportedMain() {
    vec4 fragColor;
    mainImage(fragColor, gl_FragCoord.xy);
    gl_FragColor = fragColor;
}

void main() {
  scrnsvrImportedMain();
  if (palette == 1) {
    // Soft-compress the source range so dark, middle and bright tones all
    // contribute: a bright cloudscape must still respond to the shadow tone.
    float raw = max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b));
    float tone = max(raw, 0.0) / (1.0 + max(raw, 0.0));
    vec3 mapped = mix(shadowColor, midtoneColor, tone);
    mapped = mix(mapped, highlightColor, tone * tone);
    gl_FragColor.rgb = mapped + highlightColor * max(raw - 1.0, 0.0);
  }
  vec3 color = (gl_FragColor.rgb - 0.5) * contrast + 0.5;
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(mix(vec3(luminance), color, saturation) * brightness, 1.0);
}
