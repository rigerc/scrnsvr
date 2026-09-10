// Ported from AVS/seascape.glsl; original notices are preserved below.
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

// Standalone GLSL for use with shader.cpp host


// Procedural value-noise replacement for iChannel0 lookups.
float hash2( vec2 p ) {
    p = fract(p * vec2(0.1031, 0.1030));
    p += dot(p, p.yx + 19.19);
    return fract((p.x + p.y) * p.x);
}

float vnoise2( vec2 p ) {
    vec2 ip = floor(p);
    vec2 f  = fract(p);
    f = f*f*(3.0-2.0*f);
    float a = hash2(ip + vec2(0,0));
    float b = hash2(ip + vec2(1,0));
    float c = hash2(ip + vec2(0,1));
    float d = hash2(ip + vec2(1,1));
    return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}

float cosNoise( in vec2 p )
{
    return 0.5*( sin(p.x) + sin(p.y) );
}

const mat2 m2 = mat2(1.6,-1.2,
                     1.2, 1.6);

float sdTorus( vec3 p, vec2 t )
{
  return length( vec2(length(p.xz)-t.x,p.y) )-t.y;
}


float smin( float a, float b, float k )
{
    float h = clamp( 0.5 + 0.5*(b-a)/k, 0.0, 1.0 );
    return mix( b, a, h ) - k*h*(1.0-h);
}

float map( in vec3 pos )
{
    float h = 0.0;
    vec2 q = pos.xz*0.5;

    float s = 0.5;
    for( int i=0; i<6; i++ )
    {
        h += s*cosNoise( q );
        q = m2*q*0.85;
        q += vec2(2.41,8.13);
        s *= 0.48 + 0.2*h;
    }
    h *= 3.0;

    float d1 = pos.y - h;

    // rings
    vec3 r1 = mod(2.3+pos+5.0,10.0)-5.0;
    r1.y = pos.y-0.1 - 0.7*h;
    float d2 = sdTorus( r1.xzy, vec2(1.0,0.05) );


    return smin( d1, d2, 1.0 );
}

float mapH( in vec3 pos )
{
    float h = 0.0;
    vec2 q = pos.xz*0.5;

    float s = 0.5;
    for( int i=0; i<12; i++ )
    {
        h += s*cosNoise( q );
        q = m2*q*0.85;
        q += vec2(2.41,8.13);
        s *= 0.48 + 0.2*h;
    }
    h *= 3.0;

    float d1 = pos.y - h;

    // rings
    vec3 r1 = mod(2.3+pos+5.0,10.0)-5.0;
    r1.y = pos.y-0.1 - 0.7*h;
    float d2 = sdTorus( r1.xzy, vec2(1.0,0.05) );


    return smin( d1, d2, 1.0 );
}

vec3 calcNormal( in vec3 pos )
{
    vec2 e = vec2(1.0,-1.0) * 0.001;

    return normalize( e.xyy*mapH( pos + e.xyy ) +
                      e.yyx*mapH( pos + e.yyx ) +
                      e.yxy*mapH( pos + e.yxy ) +
                      e.xxx*mapH( pos + e.xxx ) );
}

float softShadows( in vec3 ro, in vec3 rd )
{
    float res = 1.0;
    float t = 0.01;
    for( int i=0; i<64; i++ )
    {
        vec3 pos = ro + rd*t;
        float h = map( pos );
        res = min( res, max(h,0.0)*164.0/t );
        if( res<0.001 ) break;
        t += h*0.5;
    }

    return res;
}


void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 p = fragCoord.xy / iResolution.xy;
    vec2 q = (-iResolution.xy + 2.0* fragCoord.xy) / iResolution.y;

    float ani = iTime*0.5;

    // ray
    vec3 ro = vec3( 0.0, 2.5, -ani*0.5 );

    float roll = 0.2*sin(0.1*ani);
    q = mat2( cos(roll), -sin(roll), sin(roll), cos(roll) ) * q;

    vec3 rd = normalize( vec3(q-vec2(-0.4,0.4),-2.0) );

    vec3 col = vec3( 0.7, 0.8, 1.0 );
    col *= 1.0 - 0.5*rd.y;

    // raymarcher
    float tmax = 120.0;
    float t = 0.0;
    for( int i=0; i<200; i++ )
    {
        vec3 pos = ro + rd*t;
        float h = map( pos );
        if( h<0.001 || t>tmax ) break;
        t += h*0.5;
    }

    vec3 light = normalize( vec3( 1.0, 0.5, -1.0) );
    // hit
    if( t<tmax )
    {
        // shade and light
        vec3 pos = ro + t*rd;
        vec3 nor = calcNormal( pos );

        float bak = clamp( dot(nor,normalize(-vec3(light.x,0.0,light.z))), 0.0, 1.0 );
        float dif = clamp( dot(nor,light), 0.0, 1.0 );
        float sha =softShadows( pos+nor*.01, light );
        vec3 lig = vec3(2.0,1.5,1.0)*dif*1.5*sha;
             lig += vec3(0.2,0.3,0.4)*max(nor.y,0.0)*0.9;
             lig += vec3(0.1,0.1,0.1)*bak*0.5;
        vec3 mate = vec3(0.3,0.3,0.3)*0.5;
        mate = mix( mate, vec3(0.2,0.15,0.1)*0.73, smoothstep( 0.7,0.9,nor.y) );
        mate *= 0.5 + vnoise2( 0.5*pos.xz )*1.0;

        col = mate * lig;

        float fog = exp( -0.0015*t*t );
        col *= fog;
        col += (1.0-fog)*vec3(0.5,0.6,0.7);
    }

    float sun = clamp( dot(rd,light), 0.0, 1.0 );
    col += vec3(1.0,0.8,0.6)*0.4*pow(sun,16.0);
    col += vec3(1.0,0.8,0.6)*0.3*pow(sun,8.0);

    col = sqrt( col );

    col *= 0.5 + 0.5*pow(16.0*p.x*p.y*(1.0-p.x)*(1.0-p.y),0.2);

    col = smoothstep( 0.0, 1.0, col );

    col = mix( col, vec3(dot(col,vec3(0.33))), -0.25 );

    fragColor = vec4( col, 1.0 );
}

void scrnsvrImportedMain() {
    // Vertical scanline skip: every other column black, saves 50% GPU
    vec2 fc = gl_FragCoord.xy;
    if (mod(floor(fc.x), 2.0) < 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }
    vec4 fragColor;
    mainImage(fragColor, fc);
    gl_FragColor = fragColor;
}

void main() {
  scrnsvrImportedMain();
  vec3 color = (gl_FragColor.rgb - 0.5) * contrast + 0.5;
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(mix(vec3(luminance), color, saturation) * brightness, 1.0);
}
