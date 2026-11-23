precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float spread;
uniform float edgeSoftness;
uniform float paperFidelity;
uniform int compositionSeed;
uniform float speed;
uniform float scale;
uniform float curl;
uniform float density;
uniform float feather;
uniform float brightness;
uniform float saturation;
uniform vec3 color1;
uniform vec3 color2;
uniform vec3 background;
#else
#define uTime iTime
#define uResolution iResolution.xy
const float spread = 1.0;
const float edgeSoftness = 1.0;
const float paperFidelity = 0.0;
const int compositionSeed = 0;
const float speed = 0.3;
const float scale = 2.0;
const float curl = 0.85;
const float density = 0.65;
const float feather = 0.6;
const float brightness = 1.0;
const float saturation = 1.0;
const vec3 color1 = vec3(0.098039, 0.145098, 0.274510);
const vec3 color2 = vec3(0.603922, 0.321569, 0.435294);
const vec3 background = vec3(0.913725, 0.882353, 0.815686);
#endif

// 2D simplex noise from LYGIA, Stefan Gustavson and Ian McEwan.
// Copyright 2021-2023. MIT license; see THIRD_PARTY_SHADERS.md.
// Only the vec2 overload and required mod289/permute overloads are embedded.
vec2 mod289(const in vec2 x) { return x - floor(x * (1. / 289.)) * 289.; }
vec3 mod289(const in vec3 x) { return x - floor(x * (1. / 289.)) * 289.; }
vec3 permute(const in vec3 v) { return mod289(((v * 34.0) + 1.0) * v); }
float snoise(in vec2 v) {
    const vec4 C = vec4(0.211324865405187,  // (3.0-sqrt(3.0))/6.0
                        0.366025403784439,  // 0.5*(sqrt(3.0)-1.0)
                        -0.577350269189626,  // -1.0 + 2.0 * C.x
                        0.024390243902439); // 1.0 / 41.0
    // First corner
    vec2 i  = floor(v + dot(v, C.yy) );
    vec2 x0 = v -   i + dot(i, C.xx);

    // Other corners
    vec2 i1;
    //i1.x = step( x0.y, x0.x ); // x0.x > x0.y ? 1.0 : 0.0
    //i1.y = 1.0 - i1.x;
    i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    // x0 = x0 - 0.0 + 0.0 * C.xx ;
    // x1 = x0 - i1 + 1.0 * C.xx ;
    // x2 = x0 - 1.0 + 2.0 * C.xx ;
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;

    // Permutations
    i = mod289(i); // Avoid truncation effects in permutation
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
    + i.x + vec3(0.0, i1.x, 1.0 ));

    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m ;
    m = m*m ;

    // Gradients: 41 points uniformly over a line, mapped onto a diamond.
    // The ring size 17*17 = 289 is close to a multiple of 41 (41*7 = 287)

    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;

    // Normalise gradients implicitly by scaling m
    // Approximation of: m *= inversesqrt( a0*a0 + h*h );
    m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );

    // Compute final noise value at P
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

// Match the collection's exposure and color controls; keep black at zero brightness.
vec4 finish(vec3 color) {
    color = mix(1.0 - exp(-max(color, vec3(0.0)) * brightness), clamp(color * brightness, 0.0, 1.0), paperFidelity);
    float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    color = clamp(color + (dither - 0.5) / 255.0 * min(brightness, 1.0), 0.0, 1.0);
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    return vec4(clamp(mix(vec3(luminance), color, saturation), 0.0, 1.0), 1.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 p = ((fragCoord / uResolution) - 0.5) * vec2(uResolution.x / uResolution.y, 1.0) * scale;
    float t = uTime * speed;
    p += vec2(float(compositionSeed) * 0.731, float(compositionSeed) * 0.419);
    vec2 drift = vec2(t * 0.035, -t * 0.055);
    vec2 warp = vec2(snoise(p * 0.85 + drift), snoise(p * 0.85 - drift + 7.3));
    vec2 q = p + curl * warp;
    float cloud = snoise(q + drift);
    float detail = snoise(q * 3.0 - drift * 0.7);
    float fine = snoise(q * 7.0 + warp);
    float pigment = smoothstep(0.15 - 0.4 * edgeSoftness, 0.15 + 0.4 * edgeSoftness, cloud * spread + feather * (detail * 0.22 + fine * 0.06) + density - 0.65);
    float veins = 0.5 + 0.5 * sin(cloud * 14.0 + detail * 3.0);
    vec3 ink = mix(color1, color2, smoothstep(-0.6, 0.7, warp.y + detail * 0.3));
    vec3 color = mix(background, ink * (0.7 + 0.3 * veins), pigment * 0.94);
    fragColor = finish(color);
}
