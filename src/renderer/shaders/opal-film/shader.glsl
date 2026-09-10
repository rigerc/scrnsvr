precision highp float;

uniform float uTime;
uniform vec2 uResolution;
varying vec2 vUv;
uniform float speed;
uniform float scale;
uniform float iridescence;
uniform float distortion;
uniform float sheen;
uniform float brightness;
uniform float saturation;
uniform vec3 color1;
uniform vec3 color2;
uniform vec3 background;

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
void finish(vec3 color) {
    color = 1.0 - exp(-max(color, vec3(0.0)) * brightness);
    float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    color = clamp(color + (dither - 0.5) / 255.0 * min(brightness, 1.0), 0.0, 1.0);
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor = vec4(clamp(mix(vec3(luminance), color, saturation), 0.0, 1.0), 1.0);
}

void main() {
    vec2 p = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
    float t = uTime * speed;
    vec2 q = p * scale;
    float n = snoise(q * 1.1 + vec2(t * 0.09, -t * 0.06));
    float fold = q.y + 0.38 * sin(q.x * 2.6 + t * 0.22) + distortion * n * 0.65;
    float phase = fold * 8.0 + t * 0.3;
    vec3 spectral = 0.5 + 0.5 * cos(phase + vec3(0.0, 2.1, 4.2));
    vec3 tint = mix(color1, color2, 0.5 + 0.5 * sin(phase * 0.53));
    vec3 film = tint * (0.55 + iridescence * spectral);
    float pearl = pow(0.5 + 0.5 * cos(fold * 4.2 - n), 12.0);
    float fine = pow(0.5 + 0.5 * sin(phase + n * 2.0), 24.0);
    vec3 color = mix(background, film, 0.83) + sheen * (pearl * 0.65 + fine * 0.12);
    color *= 0.85 + 0.15 * cos(length(p) * 1.8);
    finish(color);
}
