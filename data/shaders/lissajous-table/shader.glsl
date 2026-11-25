precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform int gridSize;
uniform float padding;
uniform float trace;
uniform float phaseDrift;
uniform float lineWidth;
uniform float brightness;
uniform float saturation;
uniform vec3 color1;
uniform vec3 color2;
uniform vec3 background;
#else
#define uTime iTime
#define uResolution iResolution.xy
const float speed = 0.3;
const int gridSize = 4;
const float padding = 0.22;
const float trace = 0.6;
const float phaseDrift = 0.5;
const float lineWidth = 1.0;
const float brightness = 1.0;
const float saturation = 1.0;
const vec3 color1 = vec3(0.952941, 0.788235, 0.545098);
const vec3 color2 = vec3(0.474510, 0.721569, 0.850980);
const vec3 background = vec3(0.039216, 0.058824, 0.090196);
#endif

// Match the collection's exposure and color controls; keep black at zero brightness.
vec4 finish(vec3 color) {
    color = 1.0 - exp(-max(color, vec3(0.0)) * brightness);
    float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    color = clamp(color + (dither - 0.5) / 255.0 * min(brightness, 1.0), 0.0, 1.0);
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    return vec4(clamp(mix(vec3(luminance), color, saturation), 0.0, 1.0), 1.0);
}

const int SEGMENTS = 96;

vec2 figure(float a, float fx, float fy, float shift) {
    return vec2(sin(fx * a + shift), sin(fy * a));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 p = ((fragCoord / uResolution) - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
    float t = uTime * speed;
    float px = 1.0 / uResolution.y;
    float n = float(gridSize);
    // The table is (n + 1) cells square: a header row and column of circles, then the figures.
    float cellSize = 0.92 / (n + 1.0);
    vec2 grid = p / cellSize + (n + 1.0) * 0.5;
    vec2 cell = floor(grid);
    vec3 color = background;
    if (cell.x >= 0.0 && cell.y >= 0.0 && cell.x <= n && cell.y <= n && !(cell.x < 0.5 && cell.y > n - 0.5)) {
        vec2 local = (fract(grid) - 0.5) * cellSize;
        float radius = cellSize * 0.5 * (1.0 - padding);
        float column = cell.x;
        float row = n - cell.y;
        // Header row (row 0) circles turn at the column's frequency, the header column at the row's.
        float fx = max(column, 1.0);
        float fy = max(row, 1.0);
        bool header = column < 0.5 || row < 0.5;
        float shift = header ? 1.5707963 : t * phaseDrift * 0.12 + 1.5707963;
        if (column < 0.5) fx = fy;
        if (row < 0.5) fy = fx;
        float head = t * 0.35;
        float tail = trace * 6.2831853;
        float best = 1e5;
        float bestAge = 1.0;
        vec2 previous = figure(head - tail * 0.0, fx, fy, shift);
        for (int i = 1; i <= SEGMENTS; i++) {
            float a = head - 6.2831853 * float(i) / float(SEGMENTS);
            vec2 current = figure(a, fx, fy, shift);
            vec2 pa = local - previous * radius;
            vec2 ba = (current - previous) * radius;
            float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
            float d = length(pa - ba * h);
            // Age along the curve: 0 at the moving point, 1 a full turn behind it.
            float age = (float(i) - 1.0 + h) / float(SEGMENTS);
            if (d < best - 0.2 * px || (d < best + 0.2 * px && age < bestAge)) {
                best = d;
                bestAge = age;
            }
            previous = current;
        }
        float core = 0.5 * lineWidth * px;
        float line = 1.0 - smoothstep(core, core + 1.2 * px, best);
        float trail = 1.0 - smoothstep(0.0, trace, bestAge);
        vec3 tint = header ? color2 : mix(color2, color1, 0.35 + 0.65 * trail);
        color += tint * line * (0.16 + 0.95 * trail * trail);
        // The moving point itself.
        vec2 marker = local - figure(head, fx, fy, shift) * radius;
        color += mix(color1, vec3(1.0), 0.35) * exp(-dot(marker, marker) / (px * px * 6.0 + 0.000004)) * 0.9;
    }
    fragColor = finish(color);
}
