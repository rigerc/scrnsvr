// Ported from AVS/galaxy.glsl; original notices are preserved below.
precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float contrast;
uniform float brightness;
uniform float saturation;
#define time (uTime * speed)
#define resolution (uResolution)

float scrnsvrTanh(float value) { float e = exp(clamp(2.0 * value, -40.0, 40.0)); return (e - 1.0) / (e + 1.0); }
vec2 scrnsvrTanh(vec2 value) { return vec2(scrnsvrTanh(value.x), scrnsvrTanh(value.y)); }
vec3 scrnsvrTanh(vec3 value) { return vec3(scrnsvrTanh(value.x), scrnsvrTanh(value.y), scrnsvrTanh(value.z)); }
vec4 scrnsvrTanh(vec4 value) { return vec4(scrnsvrTanh(value.x), scrnsvrTanh(value.y), scrnsvrTanh(value.z), scrnsvrTanh(value.w)); }

#define repeat(i, n) for(int i = 0; i < n; i++)

void scrnsvrImportedMain(void)
{
    vec2 uv = gl_FragCoord.xy / resolution.xy - .5;
    uv.y *= resolution.y / resolution.x;
    float mul = resolution.x / resolution.y;
    vec3 dir = vec3(uv * mul, 1.);
    float a2 = time * 20. + .5;
    float a1 = 1.0;
    mat2 rot1 = mat2(cos(a1), sin(a1), -sin(a1), cos(a1));
    mat2 rot2 = rot1;
    dir.xz *= rot1;
    dir.xy *= rot2;
    vec3 from = vec3(0., 0., 0.);
    from += vec3(.0025 * time, .03 * time, -2.);
    from.xz *= rot1;
    from.xy *= rot2;
    float s = .1, fade = .07;
    vec3 v = vec3(0.4);
    repeat(r, 10) {
        vec3 p = from + s * dir * 1.5;
        p = abs(vec3(0.750) - mod(p, vec3(0.750 * 2.)));
        p.x += float(r * r) * 0.01;
        p.y += float(r) * 0.02;
        float pa, a = pa = 0.;
        repeat(i, 12) {
            p = abs(p) / dot(p, p) - 0.340;
            a += abs(length(p) - pa * 0.2);
            pa = length(p);
        }
        a *= a * a * 2.;
        v += vec3(s, s * s, s * s * s * s) * a * 0.0017 * fade;
        fade *= 0.960;
        s += 0.110;
    }
    v = mix(vec3(length(v)), v, 0.9);
    gl_FragColor = vec4(v * 0.01, 1.);
}

void main() {
  scrnsvrImportedMain();
  vec3 color = (gl_FragColor.rgb - 0.5) * contrast + 0.5;
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(mix(vec3(luminance), color, saturation) * brightness, 1.0);
}
