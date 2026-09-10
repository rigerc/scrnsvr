// Ported from ShaderSaver/shader4.txt; original notices are preserved below.
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
    "Origami" by @XorDev

    I wanted to try out soft shading like paper,
    but quickly discovered it looks better with
    color and looks like bounce lighting!

    X : X.com/XorDev/status/1727206969038213426
    Twigl: twigl.app?ol=true&ss=-NjpcsfowUETZLMr_Ki6

    <512 char playlist: shadertoy.com/playlist/N3SyzR
    Thanks to FabriceNeyret2 for many tricks
*/
//Rotate trick
#define R mat2(cos(a/4.+vec4(0,11,33,0)))

void mainImage(out vec4 O, vec2 I) {
  vec4 h = vec4(1.0);
  O = h;
  vec2 r = iResolution.xy;
  for (int layer = 0; layer < 6; ++layer) {
    float i = float(6 - layer);
    float a = iTime * 4.0 + i * 0.4;
    a -= sin(a);
    a -= sin(a);
    vec2 u = (I + I - r) / r.y / 0.1;
    float L = max(length(u -= R * clamp(u * R, -i, i)), 1.0);
    float l = L - 1.0;
    float A = min(l * r.y * 0.02, 1.0);
    h = sin(i + a / 3.0 + vec4(1,3,5,0)) * 0.2 + 0.7;
    O = mix(h, O, A) * (l + h + 0.5 * A * u.y / L) / L;
  }
}

///Original [329]
/*
//Rotate trick
#define R mat2(cos(a/4.+vec4(0,11,33,0)))

void mainImage(out vec4 O, vec2 I )
{
    //Initialize hue and clear fragcolor
    vec4 h; O=++h;

    //Uvs and resolution for scaling
    vec2 u,r=iResolution.xy;
    //Alpha, length, angle and iterator/radius
    for(float A,l,a,i=.6;i>.1;i-=.1)
        //Smoothly rotate a quarter at a time
        a-=sin(a-=sin(a=(iTime+i)*4.)),
        //Scale and center
        u=(I+I-r)/r.y,
        //Compute round square SDF
        l=max(length(u-=R*clamp(u*R,-i,i)),.1),
        //Compute anti-aliased alpha using SDF
        A=min((l-.1)*r.y*.2,1.),
        //Pick layer color
        O=mix(h=sin(i/.1+a/3.+vec4(1,3,5,0))*.2+.7,O,A)*
        //Soft shading
        mix(h/h,h+.5*A*u.y/l,.1/l);
}
*/

void main() {
  vec4 importedColor = vec4(0.0);
  mainImage(importedColor, gl_FragCoord.xy);
  gl_FragColor = importedColor;
  vec3 color = (gl_FragColor.rgb - 0.5) * contrast + 0.5;
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(mix(vec3(luminance), color, saturation) * brightness, 1.0);
}
