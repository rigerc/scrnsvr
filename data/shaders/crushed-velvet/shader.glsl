precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float scale;
uniform float crush;
uniform float pile;
uniform float lightAngle;
uniform float lightOrbit;
uniform float brightness;
uniform float saturation;
uniform vec3 highlightColor;
uniform vec3 color1;
uniform vec3 color2;
uniform vec3 background;
#else
#define uTime iTime
#define uResolution iResolution.xy
const float speed = 0.3;
const float scale = 1.2;
const float crush = 0.6;
const float pile = 0.5;
const float lightAngle = 40.0;
const float lightOrbit = 0.5;
const float brightness = 1.0;
const float saturation = 1.0;
const vec3 highlightColor = vec3(0.964706, 0.862745, 0.909804);
const vec3 color1 = vec3(0.490196, 0.141176, 0.266667);
const vec3 color2 = vec3(0.784314, 0.345098, 0.498039);
const vec3 background = vec3(0.070588, 0.027451, 0.050980);
#endif

// Match the collection's exposure and color controls; keep black at zero brightness.
vec4 finish(vec3 color) {
    color = 1.0 - exp(-max(color, vec3(0.0)) * brightness);
    float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    color = clamp(color + (dither - 0.5) / 255.0 * min(brightness, 1.0), 0.0, 1.0);
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    return vec4(clamp(mix(vec3(luminance), color, saturation), 0.0, 1.0), 1.0);
}

float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

vec2 gradientAt(vec2 i) {
    float angle = hash(i) * 6.2831853;
    return vec2(cos(angle), sin(angle));
}

// Gradient noise in 0..1. Lighting reads its slope, and value noise's slope collapses
// along every lattice line, which would show as faint straight seams.
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float a = dot(gradientAt(i), f);
    float b = dot(gradientAt(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
    float c = dot(gradientAt(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
    float d = dot(gradientAt(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
    return clamp(0.5 + 0.75 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y), 0.0, 1.0);
}

// Folded fabric height: smooth swells plus creases whose sharpness follows Crush.
float fabric(vec2 q, float t) {
    vec2 warp = vec2(noise(q * 0.7 + vec2(t * 0.02, 3.1)), noise(q * 0.7 + vec2(8.2, -t * 0.015))) - 0.5;
    q += warp * 1.2;
    float height = 0.0;
    float amplitude = 0.55;
    for (int i = 0; i < 3; i++) {
        float n = noise(q);
        // A rounded crease: a hard abs() leaves slope breaks the sheen turns into sharp seams.
        float centered = n * 2.0 - 1.0;
        float ridge = 1.0 - sqrt(centered * centered + 0.012);
        height += amplitude * mix(n, ridge * ridge, crush);
        q = mat2(1.6, 1.2, -1.2, 1.6) * q + 11.7;
        amplitude *= 0.42;
    }
    return height;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 p = ((fragCoord / uResolution) - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
    float t = uTime * speed;
    vec2 q = p * 1.7 / scale;
    float e = 0.012;
    float h = fabric(q, t);
    vec2 slope = vec2(fabric(q + vec2(e, 0.0), t) - h, fabric(q + vec2(0.0, e), t) - h) / e;
    float relief = mix(0.7, 1.7, crush);
    vec3 normal = normalize(vec3(-slope * relief, 1.0));
    float light = radians(lightAngle) + t * lightOrbit * 0.15;
    vec3 toLight = normalize(vec3(cos(light), sin(light), 0.55));
    // Velvet: the pile catches light where it turns away from the viewer, strongest on the lit side.
    float facing = clamp(normal.z, 0.0, 1.0);
    float rim = pow(1.0 - facing, mix(5.0, 1.4, pile));
    vec2 tilt = normal.xy / max(length(normal.xy), 1e-4);
    float side = 0.25 + 0.75 * smoothstep(-0.3, 0.9, dot(tilt, toLight.xy));
    float sheen = clamp(rim * side * 3.2, 0.0, 1.6);
    float diffuse = clamp(dot(normal, toLight), 0.0, 1.0);
    vec3 color = mix(background, color1, 0.35 + 0.55 * diffuse);
    color += color2 * sheen * 0.95;
    color += highlightColor * pow(sheen / 1.6, 3.0) * 0.55;
    // Deep folds fall into shadow.
    color *= 0.65 + 0.35 * smoothstep(0.15, 0.75, h);
    fragColor = finish(color);
}
