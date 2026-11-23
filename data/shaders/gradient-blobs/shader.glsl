precision highp float;

#ifdef SCRNSVR
uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float size;
uniform float softness;
uniform int count;
uniform vec3 color1;
uniform vec3 color2;
uniform vec3 color3;
uniform vec3 background;
uniform float brightness;
uniform float saturation;
uniform float movementRange;
uniform float stretchX;
uniform float stretchY;
uniform float sizeVariation;
uniform float breathing;
uniform float haloStrength;
#else
#define uTime iTime
#define uResolution iResolution.xy
const float speed = 0.4;
const float size = 0.19;
const float softness = 0.45;
const int count = 5;
const vec3 color1 = vec3(0.623529, 0.388235, 1.000000);
const vec3 color2 = vec3(1.000000, 0.443137, 0.603922);
const vec3 color3 = vec3(0.313725, 0.858824, 0.909804);
const vec3 background = vec3(0.043137, 0.062745, 0.160784);
const float brightness = 1.0;
const float saturation = 1.0;
const float movementRange = 1.0;
const float stretchX = 1.0;
const float stretchY = 1.0;
const float sizeVariation = 0.0;
const float breathing = 1.0;
const float haloStrength = 0.16;
#endif

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 aspect = uResolution / min(uResolution.x, uResolution.y);
  vec2 p = ((fragCoord / uResolution) - 0.5) * aspect;
  float t = uTime * speed;
  float field = 0.0;
  vec3 pigment = vec3(0.0);
  // Fixed loop bounds also compile on WebGL 1 implementations.
  for (int i = 0; i < 8; i++) {
    if (i < count) {
      float index = float(i);
      float phase = index * 2.399963;
      vec2 center = movementRange * aspect * vec2(
        0.34 * sin(t * (0.23 + index * 0.017) + phase),
        0.32 * cos(t * (0.29 + index * 0.013) + phase * 1.3)
      );
      float radius = size * mix(1.0, 0.85 + 0.15 * sin(t * 0.3 + phase), breathing)
        * (1.0 + sizeVariation * sin(phase * 2.1));
      vec2 delta = (p - center) / vec2(stretchX, stretchY);
      float influence = radius * radius / max(dot(delta, delta), 0.0001);
      float tint = mod(index, 3.0);
      vec3 blobColor = tint < 0.5 ? color1 : (tint < 1.5 ? color2 : color3);
      pigment += blobColor * influence;
      field += influence;
    }
  }
  vec3 color = pigment / max(field, 0.0001);
  float edge = mix(0.04, 0.7, softness);
  float body = smoothstep(1.0 - edge, 1.0 + edge, field);
  float halo = haloStrength * smoothstep(0.05, 1.0, field);
  color = mix(background, color, clamp(body + halo * (1.0 - body), 0.0, 1.0));
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  fragColor = vec4(clamp(color + (dither - 0.5) / 255.0, 0.0, 1.0), 1.0);
  fragColor.rgb *= brightness;
  float luminance = dot(fragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  fragColor.rgb = mix(vec3(luminance), fragColor.rgb, saturation);
}
