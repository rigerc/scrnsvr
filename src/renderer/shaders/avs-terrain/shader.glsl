// Ported from AVS/terrain.glsl; original notices are preserved below.
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

// Terrain — mountains and valleys with procedural soil
// Based on techniques by Inigo Quilez
// Rewritten for continuous flyover, no scene switches


const mat2 m2 = mat2(1.6,-1.2,1.2,1.6);

// --- Procedural noise ---
float hash2d(vec2 p) {
    float h = dot(p, vec2(127.1, 311.7));
    return fract(sin(h) * 43758.5453123);
}

float noise2d(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2d(i), hash2d(i + vec2(1, 0)), u.x),
               mix(hash2d(i + vec2(0, 1)), hash2d(i + vec2(1, 1)), u.x), u.y);
}

float fbm(vec2 p) {
    float f = 0.0, s = 0.5;
    for (int i = 0; i < 6; i++) {
        f += s * noise2d(p);
        p = m2 * p;
        s *= 0.5;
    }
    return f;
}

// --- Cosine noise for terrain shape ---
float cnoise(vec2 p) {
    return 0.5 * (cos(6.2831 * p.x) + cos(6.2831 * p.y));
}

// --- Terrain height at different detail levels ---
float terrainLow(vec2 p) {
    p *= 0.0013;
    float s = 1.0, t = 0.0;
    for (int i = 0; i < 2; i++) {
        t += s * cnoise(p);
        s *= 0.5 + 0.1 * t;
        p = 0.97 * m2 * p + (t - 0.5) * 0.2;
    }
    return t * 55.0;
}

float terrainMed(vec2 p) {
    p *= 0.0013;
    float s = 1.0, t = 0.0;
    for (int i = 0; i < 6; i++) {
        t += s * cnoise(p);
        s *= 0.5 + 0.1 * t;
        p = 0.97 * m2 * p + (t - 0.5) * 0.2;
    }
    return t * 55.0;
}

float terrainHigh(vec2 p) {
    p *= 0.0013;
    float s = 1.0, t = 0.0;
    for (int i = 0; i < 7; i++) {
        t += s * cnoise(p);
        s *= 0.5 + 0.1 * t;
        p = 0.97 * m2 * p + (t - 0.5) * 0.2;
    }
    return t * 55.0;
}

// --- Desert soil texture ---
vec3 soilTexture(vec3 pos, vec3 nor, vec3 rd, float dist) {
    vec3 drySand  = vec3(0.22, 0.18, 0.12);
    vec3 redEarth = vec3(0.18, 0.10, 0.06);
    vec3 paleSand = vec3(0.28, 0.24, 0.16);
    vec3 rock     = vec3(0.10, 0.08, 0.07);
    vec3 darkRock = vec3(0.05, 0.04, 0.04);

    float n1 = fbm(pos.xz * 0.015);
    float n2 = fbm(pos.xz * 0.06);
    float n3 = fbm(pos.xz * 0.25);
    float n4 = fbm(pos.xz * 1.2);

    // Base: blend between dry sand and red earth
    vec3 col = mix(drySand, redEarth, smoothstep(0.25, 0.65, n1));
    // Pale sand patches
    col = mix(col, paleSand, smoothstep(0.4, 0.7, n2) * 0.5);

    float slope = 1.0 - nor.y;

    // Wind-blown sand ripples on flat areas
    float ripple = sin(pos.x * 0.8 + pos.z * 0.3 + n3 * 5.0) * 0.5 + 0.5;
    col = mix(col, paleSand * 1.1, ripple * smoothstep(0.3, 0.1, slope) * 0.2);

    // Fine grain
    col *= 0.85 + 0.3 * n3;
    col *= 0.9 + 0.2 * n4;

    // Rocky on steep slopes
    col = mix(col, rock, smoothstep(0.4, 0.7, slope));
    col = mix(col, darkRock, smoothstep(0.7, 0.9, slope));

    // Height: higher = darker exposed rock
    float hv = smoothstep(25.0, 90.0, pos.y);
    col = mix(col, darkRock, hv * 0.6);

    return col;
}

// --- Map: terrain only, no tubes ---
float map(vec3 pos) {
    return pos.y - terrainMed(pos.xz);
}

float mapHigh(vec3 pos) {
    return pos.y - terrainHigh(pos.xz);
}

// --- Raymarching ---
float intersect(vec3 ro, vec3 rd, float tmin, float tmax) {
    float t = tmin;
    for (int i = 0; i < 160; i++) {
        vec3 pos = ro + t * rd;
        float h = map(pos);
        if (h < (0.001 * t) || t > tmax) break;
        t += h * 0.5;
    }
    return t;
}

float calcShadow(vec3 ro, vec3 rd) {
    float h1 = terrainMed(ro.xz);
    float d1 = 10.0, d2 = 80.0, d3 = 200.0;
    float s1 = clamp(1.0 * (h1 + rd.y * d1 - terrainMed(ro.xz + d1 * rd.xz)), 0.0, 1.0);
    float s2 = clamp(0.5 * (h1 + rd.y * d2 - terrainMed(ro.xz + d2 * rd.xz)), 0.0, 1.0);
    float h2 = terrainLow(ro.xz);
    float s3 = clamp(0.2 * (h2 + rd.y * d3 - terrainLow(ro.xz + d3 * rd.xz)), 0.0, 1.0);
    return min(min(s1, s2), s3);
}

vec3 calcNormal(vec3 pos, float t) {
    vec2 e = vec2(1.0, -1.0) * 0.001 * t;
    return normalize(e.xyy * mapHigh(pos + e.xyy) +
                     e.yyx * mapHigh(pos + e.yyx) +
                     e.yxy * mapHigh(pos + e.yxy) +
                     e.xxx * mapHigh(pos + e.xxx));
}

// --- Camera path: smooth continuous orbit ---
vec3 camPath(float t) {
    vec2 p = 1100.0 * vec2(cos(0.23 * t), cos(1.5 + 0.205 * t));
    return vec3(p.x, 0.0, p.y);
}

// --- Cloud noise (inspired by cloud.glsl) ---
vec2 cloudHash(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float cloudNoise(vec2 p) {
    const float K1 = 0.366025404, K2 = 0.211324865;
    vec2 i = floor(p + (p.x + p.y) * K1);
    vec2 a = p - i + (i.x + i.y) * K2;
    vec2 o = (a.x > a.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec2 b = a - o + K2;
    vec2 c = a - 1.0 + 2.0 * K2;
    vec3 h = max(0.5 - vec3(dot(a, a), dot(b, b), dot(c, c)), 0.0);
    vec3 n = h * h * h * h * vec3(dot(a, cloudHash(i)), dot(b, cloudHash(i + o)), dot(c, cloudHash(i + 1.0)));
    return dot(n, vec3(70.0));
}

float cloudFBM(vec2 n) {
    float total = 0.0, amplitude = 0.1;
    for (int i = 0; i < 7; i++) {
        total += cloudNoise(n) * amplitude;
        n = m2 * n;
        amplitude *= 0.4;
    }
    return total;
}

// --- Sky dome with clouds ---
vec3 dome(vec3 rd, vec3 sun) {
    float sda = clamp(0.5 + 0.5 * dot(rd, sun), 0.0, 1.0);
    float cho = max(rd.y, 0.0);

    // Base sky gradient
    vec3 skyHigh = vec3(0.2, 0.4, 0.6);
    vec3 skyLow  = vec3(0.4, 0.7, 1.0);
    vec3 bgcol = mix(skyLow, skyHigh, cho);
    bgcol = mix(bgcol, vec3(0.80, 0.70, 0.20), pow(1.0 - cho, 5.0) * sda);
    bgcol *= 0.8 + 0.2 * sda;

    // Clouds (only above horizon)
    if (rd.y > 0.01) {
        float time = iTime * 0.03;
        vec2 uv = rd.xz / (rd.y + 0.1) * 0.8;

        float q = cloudFBM(uv * 0.55);

        // Ridged noise
        float r = 0.0;
        vec2 cuv = uv * 1.1 - q + time;
        float weight = 0.8;
        for (int i = 0; i < 8; i++) {
            r += abs(weight * cloudNoise(cuv));
            cuv = m2 * cuv + time;
            weight *= 0.7;
        }

        // Soft noise
        float f = 0.0;
        cuv = uv * 1.1 - q + time;
        weight = 0.7;
        for (int i = 0; i < 8; i++) {
            f += weight * cloudNoise(cuv);
            cuv = m2 * cuv + time;
            weight *= 0.6;
        }

        f *= r + f;

        // Cloud color noise
        float cn = 0.0;
        cuv = uv * 2.2 - q + time * 2.0;
        weight = 0.4;
        for (int i = 0; i < 7; i++) {
            cn += weight * cloudNoise(cuv);
            cuv = m2 * cuv + time * 2.0;
            weight *= 0.6;
        }

        float cloudCover = 0.2;
        float cloudAlpha = 8.0;
        vec3 cloudCol = vec3(1.1, 1.1, 0.9) * clamp(0.5 + 0.3 * cn, 0.0, 1.0);
        float cloudMask = clamp(cloudCover + cloudAlpha * f * r + cn, 0.0, 1.0);

        // Blend clouds with sky — fade near horizon
        float horizonFade = smoothstep(0.01, 0.15, rd.y);
        bgcol = mix(bgcol, clamp(0.5 * bgcol + cloudCol, 0.0, 1.0), cloudMask * horizonFade);
    }

    return bgcol * 0.75;
}

mat3 setCamera(vec3 ro, vec3 ta, float cr) {
    vec3 cw = normalize(ta - ro);
    vec3 cp = vec3(sin(cr), cos(cr), 0.0);
    vec3 cu = normalize(cross(cw, cp));
    vec3 cv = normalize(cross(cu, cw));
    return mat3(cu, cv, cw);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 xy = -1.0 + 2.0 * fragCoord.xy / iResolution.xy;
    vec2 sp = xy * vec2(iResolution.x / iResolution.y, 1.0);

    // Continuous time — no scene switching
    float time = 16.5 + iTime * 0.05;

    float cr = 0.18 * sin(-0.1 * time);
    vec3 ro = camPath(time);
    vec3 ta = camPath(time + 3.0);
    ro.y = terrainLow(ro.xz) + 100.0 + 30.0 * sin(time);
    ta.y = ro.y - 200.0;
    mat3 cam = setCamera(ro, ta, cr);

    vec3 light1 = normalize(vec3(-0.8, 0.2, 0.5));
    vec3 rd = cam * normalize(vec3(sp.xy, 1.5));
    vec3 bgcol = dome(rd, light1);

    float tmin = 10.0, tmax = 4500.0;

    // Bound plane optimization
    float maxh = 130.0;
    float tp = (maxh - ro.y) / rd.y;
    if (tp > 0.0) {
        if (ro.y > maxh) tmin = max(tmin, tp);
        else             tmax = min(tmax, tp);
    }

    float sundotc = clamp(dot(rd, light1), 0.0, 1.0);
    vec3 col = bgcol;

    float t = intersect(ro, rd, tmin, tmax);
    if (t < tmax) {
        vec3 pos = ro + t * rd;
        vec3 nor = calcNormal(pos, t);
        vec3 ref = reflect(rd, nor);

        // Soil material
        col = soilTexture(pos, nor, rd, t);

        // Lighting
        float amb = clamp(nor.y, 0.0, 1.0);
        float dif = clamp(dot(light1, nor), 0.0, 1.0);
        float bac = clamp(dot(normalize(vec3(-light1.x, 0.0, light1.z)), nor), 0.0, 1.0);
        float sha = calcShadow(pos, light1);
        float spe = pow(clamp(dot(ref, light1), 0.0, 1.0), 4.0) * dif * 0.3;

        sha = 0.3 + 0.7 * sha; // soften shadows — never fully black
        vec3 lin = vec3(0.0);
        lin += dif * vec3(11.0, 6.0, 3.0) * vec3(sha);
        lin += amb * vec3(0.35, 0.40, 0.50);
        lin += bac * vec3(0.40, 0.45, 0.55);
        lin += spe * vec3(2.0);
        col *= lin;

        // Distance fog
        col = mix(col, 0.25 * mix(vec3(0.4, 0.75, 1.0), vec3(0.3, 0.3, 0.3), sundotc * sundotc), 1.0 - exp(-0.0000008 * t * t));
        col += 0.15 * vec3(1.0, 0.8, 0.3) * pow(sundotc, 8.0) * (1.0 - exp(-0.003 * t));
        col = mix(col, bgcol, 1.0 - exp(-0.00000004 * t * t));
    } else {
        // Sun glow in sky
        col += 0.2 * 0.12 * vec3(1.0, 0.5, 0.1) * pow(sundotc, 5.0);
        col += 0.2 * 0.12 * vec3(1.0, 0.6, 0.1) * pow(sundotc, 64.0);
        col += 0.2 * 0.12 * vec3(2.0, 0.4, 0.1) * pow(sundotc, 512.0);
        col += 0.2 * 0.2 * vec3(1.5, 0.7, 0.4) * pow(sundotc, 4.0);
    }

    // Post-processing
    col = pow(col, vec3(0.5));
    col = col * 1.1 * vec3(1.0, 1.0, 1.02) + vec3(0.0, 0.0, 0.05);
    col = clamp(col, 0.0, 1.0);
    col = col * col * (3.0 - 2.0 * col);
    col = mix(col, vec3(dot(col, vec3(0.333))), 0.2);
    // Vignette
    col *= 0.5 + 0.5 * pow((xy.x + 1.0) * (xy.y + 1.0) * (xy.x - 1.0) * (xy.y - 1.0), 0.1);

    fragColor = vec4(col, 1.0);
}

void scrnsvrImportedMain() {
    // Scanline skip: every other row black, saves 50% GPU
    vec2 fc = gl_FragCoord.xy;
    if (mod(floor(fc.y), 2.0) < 1.0) {
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
