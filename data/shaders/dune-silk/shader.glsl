precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;

uniform float speed;
uniform float scale;
uniform float distortion;
uniform float softness;
uniform float glow;
uniform float brightness;
uniform vec3 color1; // deep shadow
uniform vec3 color2; // midtone
uniform vec3 color3; // highlight
uniform float saturation;

#else
#define uTime iTime
#define uResolution iResolution.xy

const float speed      = 0.1;
const float scale      = 1.0;
const float distortion = 0.65;
const float softness   = 0.55;
const float glow       = 0.8;
const float brightness = 1.15;
const vec3 color1 = vec3(0.023529, 0.070588, 0.109804);
const vec3 color2 = vec3(0.101961, 0.329412, 0.368627);
const vec3 color3 = vec3(1.000000, 0.690196, 0.388235);
const float saturation = 0.9;
#endif


mat2 rotate2D(float a) {
    float c = cos(a);
    float s = sin(a);

    return mat2(
         c, -s,
         s,  c
    );
}


float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);

    return fract(p.x * p.y);
}


/*
    Smooth pseudo-noise without texture sampling.
*/
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);

    f = f * f * (3.0 - 2.0 * f);

    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));

    return mix(
        mix(a, b, f.x),
        mix(c, d, f.x),
        f.y
    );
}


float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;

    for (int i = 0; i < 4; i++) {
        value += noise(p) * amplitude;

        p = rotate2D(0.47) * p * 2.02;
        amplitude *= 0.5;
    }

    return value;
}


/*
    Distance from a slowly undulating ribbon.
*/
float ribbon(
    vec2 p,
    float offset,
    float frequency,
    float phase,
    float t
) {
    float wave =
          0.32 * sin(p.x * frequency + phase + t * 0.18)
        + 0.12 * sin(p.x * frequency * 0.47 - phase + t * 0.11)
        + 0.05 * sin(p.x * 2.4 - t * 0.08);

    return abs(p.y - wave - offset);
}


void mainImage(
    out vec4 fragColor,
    in vec2 fragCoord
) {
    vec2 uv = fragCoord / uResolution;

    vec2 p = uv - 0.5;
    p.x *= uResolution.x / uResolution.y;

    p *= scale * 2.35;

    float t = uTime * speed;


    // --------------------------------------------
    // Large-scale organic coordinate deformation
    // --------------------------------------------

    vec2 warp;

    warp.x = fbm(
        p * 0.48 +
        vec2(t * 0.035, -t * 0.018)
    );

    warp.y = fbm(
        p * 0.43 +
        vec2(4.7, 2.1) +
        vec2(-t * 0.021, t * 0.025)
    );

    warp = warp * 2.0 - 1.0;

    vec2 q = p + warp * distortion * 0.42;


    // --------------------------------------------
    // Main flowing surfaces
    // --------------------------------------------

    float d1 = ribbon(
        q,
        -0.28,
        1.05,
        0.0,
        t
    );

    float d2 = ribbon(
        q,
        0.08,
        0.82,
        1.8,
        t * 0.83
    );

    float d3 = ribbon(
        q,
        0.47,
        0.67,
        3.6,
        t * 0.68
    );


    float width1 = mix(0.08, 0.34, softness);
    float width2 = mix(0.10, 0.42, softness);
    float width3 = mix(0.14, 0.52, softness);


    float band1 =
        exp(-d1 * d1 / max(0.001, width1 * width1));

    float band2 =
        exp(-d2 * d2 / max(0.001, width2 * width2));

    float band3 =
        exp(-d3 * d3 / max(0.001, width3 * width3));


    // --------------------------------------------
    // Broad atmospheric gradient
    // --------------------------------------------

    float atmosphere =
        0.5 +
        0.5 * sin(
            q.x * 0.52 -
            q.y * 0.75 +
            t * 0.07
        );

    atmosphere = smoothstep(
        0.05,
        0.95,
        atmosphere
    );


    float field =
          band1 * 0.68
        + band2 * 0.44
        + band3 * 0.22;

    field += atmosphere * 0.20;

    field = clamp(field, 0.0, 1.0);


    // --------------------------------------------
    // Palette
    // --------------------------------------------

    vec3 col = mix(
        color1,
        color2,
        smoothstep(0.0, 0.72, field)
    );

    float highlight =
        pow(max(band1, band2 * 0.85), 2.2);

    col = mix(
        col,
        color3,
        highlight * 0.68
    );


    // --------------------------------------------
    // Soft luminous edge
    // --------------------------------------------

    float edgeDistance =
        min(d1, min(d2, d3));

    float halo =
        exp(
            -edgeDistance * edgeDistance /
            max(0.001, 0.16 + softness * 0.32)
        );

    col += color3 *
           halo *
           glow *
           0.18;


    // --------------------------------------------
    // Subtle depth / vignette
    // --------------------------------------------

    float radial =
        length(
            (uv - 0.5) *
            vec2(
                uResolution.x / uResolution.y,
                1.0
            )
        );

    col *= 1.0 - radial * 0.16;


    // --------------------------------------------
    // Film-like micro grain to reduce banding
    // --------------------------------------------

    float grain =
        hash21(
            fragCoord +
            fract(t) * 137.0
        ) - 0.5;

    col += grain / 255.0 * 1.4;


    // --------------------------------------------
    // Exposure
    // --------------------------------------------

    col =
        1.0 -
        exp(
            -max(col, 0.0) *
            brightness
        );


    // --------------------------------------------
    // Saturation
    // --------------------------------------------

    float luminance =
        dot(
            col,
            vec3(0.2126, 0.7152, 0.0722)
        );

    col = mix(
        vec3(luminance),
        col,
        saturation
    );


    fragColor = vec4(
        clamp(col, 0.0, 1.0),
        1.0
    );
}
