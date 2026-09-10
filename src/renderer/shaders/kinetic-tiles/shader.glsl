precision highp float;

uniform float uTime;
uniform vec2 uResolution;
varying vec2 vUv;
uniform float speed;
uniform float tileScale;
uniform float spacing;
uniform float rotation;
uniform float waveDelay;
uniform float slide;
uniform float brightness;
uniform float saturation;
uniform vec3 color1;
uniform vec3 color2;
uniform vec3 background;

// Match the collection's exposure and color controls; keep black at zero brightness.
void finish(vec3 color) {
    color = 1.0 - exp(-max(color, vec3(0.0)) * brightness);
    float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    color = clamp(color + (dither - 0.5) / 255.0 * min(brightness, 1.0), 0.0, 1.0);
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor = vec4(clamp(mix(vec3(luminance), color, saturation), 0.0, 1.0), 1.0);
}

void main() {
    vec2 p = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0) * tileScale;
    float t = uTime * speed;
    vec2 cell = floor(p);
    vec2 q = fract(p) - 0.5;
    float phase = t * 0.9 - (cell.x + cell.y) * waveDelay;
    float wave = sin(phase);
    q -= slide * 0.055 * vec2(cos(phase), sin(phase));
    float a = rotation * 0.72 * wave;
    q = mat2(cos(a), -sin(a), sin(a), cos(a)) * q;
    float radius = (1.0 - spacing) * 0.33;
    vec2 z = abs(q) / radius;
    float shape = pow(pow(z.x, 6.0) + pow(z.y, 6.0), 1.0 / 6.0);
    float aa = tileScale / uResolution.y / radius * 1.5;
    float mask = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, shape);
    float edge = smoothstep(0.74, 1.0, shape);
    float inset = 1.0 - smoothstep(0.045, 0.045 + aa * radius, abs(q.y + radius * 0.28));
    vec3 tint = mix(color1, color2, 0.5 + 0.5 * sin(cell.x * 0.8 - cell.y * 0.6 + t * 0.2));
    vec3 tile = tint * (0.65 + 0.22 * wave + 0.32 * edge) + inset * 0.09;
    vec3 color = mix(background, tile, mask);
    finish(color);
}
