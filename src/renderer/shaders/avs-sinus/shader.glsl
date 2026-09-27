// Ported from AVS/sinus.glsl; original notices are preserved below.
precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float contrast;
uniform float brightness;
uniform float saturation;
uniform int palette;
uniform vec3 shadowColor;
uniform vec3 midtoneColor;
uniform vec3 highlightColor;
#define time (uTime * speed)
#define resolution (uResolution)

float scrnsvrTanh(float value) { float e = exp(clamp(2.0 * value, -40.0, 40.0)); return (e - 1.0) / (e + 1.0); }
vec2 scrnsvrTanh(vec2 value) { return vec2(scrnsvrTanh(value.x), scrnsvrTanh(value.y)); }
vec3 scrnsvrTanh(vec3 value) { return vec3(scrnsvrTanh(value.x), scrnsvrTanh(value.y), scrnsvrTanh(value.z)); }
vec4 scrnsvrTanh(vec4 value) { return vec4(scrnsvrTanh(value.x), scrnsvrTanh(value.y), scrnsvrTanh(value.z), scrnsvrTanh(value.w)); }

// SINUS by Green120


void scrnsvrImportedMain( void ) {
    vec2 p = ( gl_FragCoord.xy / resolution.xy ) - 0.5;

    float sx = 0.2 * (p.x + 0.5) * sin(20.0 * p.x - 2. * time);
    float dy = 1. / (1000. * abs(p.y - sx));

    float red = .0;
    float blue = dy * 5.;
    float green = blue / .3;

    if (p.x > .0) {
        blue  += sin(p.x / 2.);
        green += p.x / 12.;
    }

    blue -= 0.4;

    gl_FragColor = vec4( vec3( red, green, blue ), 1.0 );
}

void main() {
  scrnsvrImportedMain();
  if (palette == 1) {
    // Soft-compress the source range so dark, middle and bright tones all
    // contribute: a bright cloudscape must still respond to the shadow tone.
    float raw = max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b));
    float tone = max(raw, 0.0) / (1.0 + max(raw, 0.0));
    vec3 mapped = mix(shadowColor, midtoneColor, tone);
    mapped = mix(mapped, highlightColor, tone * tone);
    gl_FragColor.rgb = mapped + highlightColor * max(raw - 1.0, 0.0);
  }
  vec3 color = (gl_FragColor.rgb - 0.5) * contrast + 0.5;
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(mix(vec3(luminance), color, saturation) * brightness, 1.0);
}
