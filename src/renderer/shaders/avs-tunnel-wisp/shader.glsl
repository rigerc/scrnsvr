// Ported from AVS/tunnelwisp.glsl; original notices are preserved below.
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

// CC0: Trailing the Twinkling Tunnelwisp
// Converted to standalone GLSL for use with shader.cpp host


float g(vec4 p,float s) {
  return abs(dot(sin(p*=s),cos(p.zxwy))-1.)/s;
}

void mainImage(out vec4 O, vec2 C) {
  float d = 0.0, z = 0.0, s = 0.0, T = iTime;
  vec4 o = vec4(0.0), q = vec4(0.0), p = vec4(0.0), U = vec4(2,1,0,3);
  vec2 r = iResolution.xy;
  for (int iteration = 0; iteration < 49; ++iteration) {
    z += d + 1.5E-3;
    q = vec4(normalize(vec3(C - 0.5 * r, r.y)) * z, 0.2);
    q.z += T / 3E1;
    s = q.y + 0.1;
    q.y = abs(s);
    p = q;
    p.y -= 0.11;
    p.xy *= mat2(cos(11.0 * U.zywz - 2.0 * p.z));
    p.y -= 0.2;
    d = abs(g(p, 8.0) - g(p, 24.0)) / 4.0;
    p = 1.0 + cos(0.7 * U + 5.0 * q.z);
    o += (s > 0.0 ? 1.0 : 0.1) * p.w * p / max(s > 0.0 ? d : d*d*d, 5E-4);
  }

  vec2 dq = abs(q.xy) - vec2(0.06, 0.15);
  float doorDist = length(max(dq, 0.0)) + min(max(dq.x, dq.y), 0.0);
  o += (1.4 + sin(T) * sin(1.7 * T) * sin(2.3 * T))
       * 1E2 * U / max(doorDist + 0.02, 0.02);
  O = scrnsvrTanh(o / 1E5);
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
