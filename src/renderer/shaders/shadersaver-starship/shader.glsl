// Ported from ShaderSaver/shader3.txt; original notices are preserved below.
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
    "Starship" by @XorDev

    Inspired by the debris from SpaceX's 7th Starship test:
    https://x.com/elonmusk/status/1880040599761596689

    My original twigl version:
    https://x.com/XorDev/status/1880344887033569682

    <512 Chars playlist: shadertoy.com/playlist/N3SyzR
*/

void mainImage(out vec4 O, vec2 I) {
  vec2 r = iResolution.xy;
  vec2 p = (I + I - r) / r.y * mat2(3,4,4,-3) / 1e2;
  vec4 S = vec4(0.0), C = vec4(1,2,3,0), W = vec4(0.0);
  float t = iTime, T = 0.1 * t + p.y;
  for (int particle = 0; particle < 50; ++particle) {
    float i = float(particle + 1);
    W = sin(i) * C;
    float noise = (0.5 + 0.5 * sin(dot(p / exp(W.x) + vec2(i,t) / 8.0, vec2(12.9898, 78.233)))) * 40.0;
    S += (cos(W) + 1.0) * exp(sin(i + i * T))
      / length(max(p, p / vec2(2.0, noise))) / 1e4;
    p += 0.02 * cos(i * (C.xz + 8.0 + i) + T + T);
  }
  C -= 1.0;
  O = scrnsvrTanh(p.x * C + S * S);
}

//Original [334]
/*
void mainImage( out vec4 O, vec2 I)
{
    //Resolution for scaling
    vec2 r = iResolution.xy,
    //Center, rotate and scale
    p = (I+I-r) / r.y * mat2(4,-3,3,4);
    //Time, trailing time and iterator variables
    float t=iTime, T=t+.1*p.x, i;

    //Iterate through 50 particles
    for(
        //Clear fragColor
        O *= i; i++<50.;

        ///Set color:
        //The sine gives us color index between -1 and +1.
        //Then we give each channel a separate frequency.
        //Red is the broadest, while blue dissipates quickly.
        //Add one to avoid negative color values (0 to 2).
        O += (cos(sin(i)*vec4(1,2,3,0))+1.)

        ///Flashing brightness:
        //The brightness fluxuates exponentially between 1/e and e.
        //Each particle has a flash frequency according to its index.
        * exp(sin(i+.1*i*T))

        ///Trail particles with attenuating light:
        //The basic idea is to start with a point light falloff.
        //I used max on the coordinates so that I can scale the
        //positive and negative directions independently.
        //The x axis is scaled down a lot for a long trail.
        //Noise is added to the scaling factor for cloudy depth.
        //The y-axis is also stretched a little for a glare effect.
        //Try a higher value like 4 for more clarity
        / length(max(p,
            p / vec2(texture(iChannel0, p/exp(sin(i)+5.)+vec2(t,i)/8.).r*40.,2))
        ))

        ///Shift position for each particle:
        //Frequencies to distribute particles x and y independently
        //i*i is a quick way to hide the sine wave periods
        //t to shift with time and p.x for leaving trails as it moves
        p+=2.*cos(i*vec2(11,9)+i*i+T*.2);

    //Add sky background and "tanh" tonemap
    O = scrnsvrTanh(.01*p.y*vec4(0,1,2,3)+O*O/1e4);
}*/

void main() {
  vec4 importedColor = vec4(0.0);
  mainImage(importedColor, gl_FragCoord.xy);
  gl_FragColor = importedColor;
  vec3 color = (gl_FragColor.rgb - 0.5) * contrast + 0.5;
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(mix(vec3(luminance), color, saturation) * brightness, 1.0);
}
