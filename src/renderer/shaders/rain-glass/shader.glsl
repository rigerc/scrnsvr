precision highp float;

uniform float uTime;
uniform vec2 uResolution;
varying vec2 vUv;
uniform float speed;
uniform float density;
uniform float streakLength;
uniform float blur;
uniform float refraction;
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

vec3 city(vec2 p, float t) {
    vec3 color = background;
    for (int i = 0; i < 12; i++) {
        float fi = float(i);
        vec2 center = vec2(sin(fi * 27.4) * 1.15, cos(fi * 13.7) * 0.46);
        center.x += 0.055 * sin(t * 0.16 + fi);
        vec2 q = p - center;
        float radius = 0.025 + 0.012 * mod(fi, 3.0);
        float soft = mix(0.006, 0.085, blur);
        float light = 1.0 - smoothstep(radius, radius + soft, length(q));
        color += mix(color1, color2, mod(fi, 2.0)) * light * 0.7;
        color += mix(color1, color2, mod(fi, 2.0)) * exp(-dot(q, q) * 12.0) * 0.07;
    }
    return color;
}
void main() {
    vec2 p = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
    float t = uTime * speed;
    vec2 offset = vec2(0.0);
    float highlights = 0.0;
    for (int layer = 0; layer < 2; layer++) {
        float fl = float(layer);
        float size = 6.0 + fl * 3.0;
        vec2 grid = p * size;
        grid.y += t * (0.22 + fl * 0.09);
        grid += fl * 17.3;
        vec2 id = floor(grid);
        vec2 q = fract(grid) - 0.5;
        float seed = fract(sin(dot(id, vec2(127.1, 311.7))) * 43758.5453);
        float visible = step(seed, density);
        q.x -= (seed - 0.5) * 0.5;
        q.y += 0.19;
        vec2 drop = q / vec2(0.1, 0.15);
        float d = length(drop);
        float aa = size / uResolution.y * 12.0;
        float mask = (1.0 - smoothstep(0.8, 1.0 + aa, d)) * visible;
        offset += drop * mask * refraction * 0.045;
        float trail = (1.0 - smoothstep(0.012, 0.035 + aa * 0.05, abs(q.x)))
            * smoothstep(0.0, 0.15, q.y) * (1.0 - smoothstep(0.15, 0.15 + streakLength * 0.5, q.y)) * visible;
        offset.x += sin(q.y * 35.0) * trail * refraction * 0.006;
        highlights += mask * pow(max(0.0, 1.0 - length(drop - vec2(-0.25, 0.35))), 6.0) * 0.3 + trail * 0.045;
    }
    vec3 color = city(p + offset, t) + highlights * mix(color1, color2, 0.5);
    finish(color);
}
