import { applyEffectControls, controlDeclarations, importedControls, paletteApplication } from './upstream-controls.mjs';

// Pure pipeline for scripts/import-upstream-shaders.mjs. The script keeps the
// argv parsing and disk writes; everything that transforms shader source lives
// here so it can be imported and tested without touching the filesystem.

export const symbolFor = (id) => `${id.replace(/-([a-z0-9])/g, (_match, letter) => letter.toUpperCase()).replace(/^[^a-z_$]/i, '_$&')}Manifest`;

export function replaceFirstMainImage(source, replacement) {
  const start = source.search(/\bvoid\s+mainImage\s*\(/);
  if (start < 0) throw new Error('Expected mainImage function');
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}' && --depth === 0) return source.slice(0, start) + replacement + source.slice(index + 1);
  }
  throw new Error('Unclosed mainImage function');
}

/** Compatibility `#define`s for the upstream uniform names a source declares or references. */
const COMPATIBILITY_RULES = [
  { names: ['iTime'], shaderSaverFallback: true, lines: ['#define iTime (uTime * speed)'] },
  { names: ['time'], shaderSaverFallback: false, lines: ['#define time (uTime * speed)'] },
  { names: ['iResolution'], shaderSaverFallback: true, lines: ['#define iResolution (vec3(uResolution, 1.0))'] },
  { names: ['resolution'], shaderSaverFallback: false, lines: ['#define resolution (uResolution)'] },
  { names: ['iMouse'], shaderSaverFallback: true, lines: ['#define iMouse (vec4(0.0))'] },
  { names: ['iTimeDelta'], shaderSaverFallback: false, lines: ['#define iTimeDelta (1.0 / 60.0)'] },
  { names: ['iFrame'], shaderSaverFallback: false, lines: ['#define iFrame int(floor(uTime * 60.0))'] },
  { names: ['iDate'], shaderSaverFallback: false, lines: ['uniform vec4 uDate;', '#define iDate (vec4(uDate.xyz, mod(uDate.w + uTime * speed, 86400.0)))'] },
];

export function compatibilityDefines(source, item) {
  const declared = (name) => new RegExp(`uniform\\s+[^;]+\\s+${name}\\s*;`).test(source);
  const uses = (name) => new RegExp(`\\b${name}\\b`).test(source);
  const defines = [];
  for (const rule of COMPATIBILITY_RULES) {
    const isDeclared = rule.names.some((name) => declared(name));
    const shaderSaverUses = rule.shaderSaverFallback && item.collection === 'ShaderSaver' && rule.names.some((name) => uses(name));
    if (isDeclared || shaderSaverUses) defines.push(...rule.lines);
  }
  return defines;
}

/** Drop GLSL ES precision preambles and upstream uniform declarations, then route tanh. */
export function stripPreamble(source) {
  return source.replace(/\r\n/g, '\n')
    .replace(/#ifdef GL_ES\s*\n\s*precision\s+(?:lowp|mediump|highp)\s+float\s*;\s*\n\s*#endif\s*/g, '')
    .replace(/^\s*precision\s+(?:lowp|mediump|highp)\s+float\s*;\s*$/gm, '')
    .replace(/^\s*uniform\s+[^;]+\s+(?:iTime|time|iResolution|resolution|iMouse|iTimeDelta|iFrame|iDate)\s*;\s*$/gm, '')
    .replace(/\btanh\s*\(/g, 'scrnsvrTanh(');
}

const replaceMain = (body, replacement) => replaceFirstMainImage(body, replacement);

/** Per-import source rewrites. Order matters: renames run before the id handlers. */
const ADAPTER_RULES = [
  { match: (item) => item.file === 'cloud.glsl', apply: (body) => body.replace(/\bspeed\b/g, 'cloudSpeed') },
  { match: (item) => item.file === 'ocean.glsl', apply: (body) => body.replace(/\bbrightness\b/g, 'oceanBrightness') },
  {
    match: (item) => item.id === 'avs-fractal',
    apply: (body) => body.replace(
      `    vec2 p = FC.xy, q, l = (p + p - r) / r.x * 0.4 + vec2(-0.25, 0.05), n;\n    float s = 6.0, h = 0.0, i = 0.0, L = dot(l + 1.8, l), e = 129.0;\n    for(; i++ < e;) l *= R(4.96), n *= R(4.8 + sin(t) * 0.05) + rotate2D(t) * 0.035,\n        h += dot(r / r, sin(q = l * s * i + n) / s * 4.0), n += cos(q),\n        s *= 1.05;`,
      `    vec2 p = FC.xy, q = vec2(0.0), l = (p + p - r) / r.x * 0.4 + vec2(-0.25, 0.05), n = vec2(0.0);\n    float s = 6.0, h = 0.0, L = dot(l + 1.8, l);\n    for (int iteration = 0; iteration < 129; iteration++) {\n        float i = float(iteration + 1);\n        l *= R(4.96);\n        n *= R(4.8 + sin(t) * 0.05) + rotate2D(t) * 0.035;\n        q = l * s * i + n;\n        h += dot(r / r, sin(q) / s * 4.0);\n        n += cos(q);\n        s *= 1.05;\n    }`,
    ),
  },
  {
    match: (item) => item.id === 'avs-matrix',
    apply: (body) => body
      .replace(
        `    vec4 p = vec4(v * mat4x2( 127.1, 311.7,\n                              269.5, 183.3,\n                              113.5, 271.9,\n                              246.1, 124.6 ));`,
        `    vec4 p = vec4(dot(v, vec2(127.1, 311.7)),\n                      dot(v, vec2(269.5, 183.3)),\n                      dot(v, vec2(113.5, 271.9)),\n                      dot(v, vec2(246.1, 124.6)));`,
      )
      .replace(
        `    vec4 p = vec4(v * mat4x3( 127.1, 311.7, 74.7,\n                              269.5, 183.3, 246.1,\n                              113.5, 271.9, 124.6,\n                              271.9, 269.5, 311.7 ) );`,
        `    vec4 p = vec4(dot(v, vec3(127.1, 311.7, 74.7)),\n                      dot(v, vec3(269.5, 183.3, 246.1)),\n                      dot(v, vec3(113.5, 271.9, 124.6)),\n                      dot(v, vec3(271.9, 269.5, 311.7)));`,
      ),
  },
  {
    match: (item) => item.id === 'avs-tunnel-wisp',
    apply: (body) => body.replace(/void mainImage\(out vec4 O,vec2 C\) \{[\s\S]*?\n\}/, `void mainImage(out vec4 O, vec2 C) {
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
}`),
  },
  {
    match: (item) => item.id === 'shadersaver-singularity',
    apply: (body) => replaceMain(body, `void mainImage(out vec4 O, vec2 F) {
  float i = 0.2;
  vec2 r = iResolution.xy;
  vec2 p = (F + F - r) / r.y / 0.7;
  vec2 d = vec2(-1.0, 1.0);
  vec2 b = p - i * d;
  vec2 c = p * mat2(1.0, 1.0, d / (0.1 + i / dot(b, b)));
  float a = dot(c, c);
  vec2 v = c * mat2(cos(0.5 * log(a) + iTime * i + vec4(0, 33, 11, 0))) / i;
  vec2 w = vec2(0.0);
  for (int wave = 0; wave < 9; ++wave) {
    i += 1.0;
    v += 0.7 * sin(v.yx * i + iTime) / i + 0.5;
    w += 1.0 + sin(v);
  }
  i = length(sin(v / 0.3) * 0.4 + c * (3.0 + d));
  O = 1.0 - exp(-exp(c.x * vec4(0.6, -0.4, -1.0, 0.0)) / w.xyyx
    / (2.0 + i*i/4.0 - i) / (0.5 + 1.0/a) / (0.03 + abs(length(p) - 0.7)));
}`),
  },
  {
    match: (item) => item.id === 'shadersaver-sunset',
    apply: (body) => replaceMain(body, `void mainImage(out vec4 O, vec2 I) {
  float t = iTime;
  float z = 0.0;
  O = vec4(0.0);
  for (int step = 0; step < 100; ++step) {
    vec3 p = z * normalize(vec3(I + I, 0.0) - iResolution.xyy);
    float frequency = 5.0;
    for (int octave = 0; octave < 6; ++octave) {
      p += 0.6 * sin(p.yzx * frequency - 0.2 * t) / frequency;
      frequency += frequency;
    }
    float s = 0.3 - abs(p.y);
    float d = 0.005 + max(s, -s * 0.2) / 4.0;
    z += d;
    O += (cos(s / 0.07 + p.x + 0.5 * t - vec4(3,4,5,0)) + 1.5) * exp(s / 0.1) / d;
  }
  O = scrnsvrTanh(O * O / 4e8);
}`),
  },
  {
    match: (item) => item.id === 'shadersaver-starship',
    apply: (body) => replaceMain(body, `void mainImage(out vec4 O, vec2 I) {
  vec2 r = iResolution.xy;
  vec2 p = (I + I - r) / r.y * mat2(3,4,4,-3) / 1e2;
  vec4 S = vec4(0.0), C = vec4(1,2,3,0), W = vec4(0.0);
  float t = iTime, T = 0.1 * t + p.y;
  for (int particle = 0; particle < 50; ++particle) {
    float i = float(particle + 1);
    W = sin(i) * C;
    float noise = (0.5 + 0.5 * sin(dot(p / exp(W.x) + vec2(i,t) / 8.0, vec2(12.9898, 78.233)))) * 40.0;
    S += (cos(W) + 1.0) * exp(sin(i + i * T))
      / length(max(p, p / vec2(2.0, noise))) / 1e4;
    p += 0.02 * cos(i * (C.xz + 8.0 + i) + T + T);
  }
  C -= 1.0;
  O = scrnsvrTanh(p.x * C + S * S);
}`),
  },
  {
    match: (item) => item.id === 'shadersaver-origami',
    apply: (body) => replaceMain(body, `void mainImage(out vec4 O, vec2 I) {
  vec4 h = vec4(1.0);
  O = h;
  vec2 r = iResolution.xy;
  for (int layer = 0; layer < 6; ++layer) {
    float i = float(6 - layer);
    float a = iTime * 4.0 + i * 0.4;
    a -= sin(a);
    a -= sin(a);
    vec2 u = (I + I - r) / r.y / 0.1;
    float L = max(length(u -= R * clamp(u * R, -i, i)), 1.0);
    float l = L - 1.0;
    float A = min(l * r.y * 0.02, 1.0);
    h = sin(i + a / 3.0 + vec4(1,3,5,0)) * 0.2 + 0.7;
    O = mix(h, O, A) * (l + h + 0.5 * A * u.y / L) / L;
  }
}`),
  },
  {
    match: (item) => item.id === 'shadersaver-shield',
    apply: (body) => replaceMain(body, `void mainImage(out vec4 O, vec2 I) {
  float t = iTime * 0.91;
  O = vec4(0.0);
  for (int step = 0; step < 100; ++step) {
    float i = float(step) * 0.01;
    vec2 v = iResolution.xy;
    vec2 p = (I + I - v) / v.y * i;
    float z = max(1.0 - dot(p, p), 0.0);
    p /= 0.2 + sqrt(z) * 0.3;
    p.y += fract(ceil(p.x = p.x / 0.9 + t) * 0.5) + t * 0.2;
    v = abs(fract(p) - 0.5);
    O += vec4(2,3,5,1) / 2e3 * z / (abs(max(v.x * 1.5 + v, v + v).y - 1.0) + 0.1 - i * 0.09);
  }
  O = scrnsvrTanh(O * O);
}`),
  },
  {
    match: (item) => item.id === 'shadersaver-ghosts',
    apply: (body) => replaceMain(body, `void mainImage(out vec4 O, vec2 I) {
  float t = iTime, z = 0.0;
  O = vec4(0.0);
  for (int step = 0; step < 100; ++step) {
    vec3 p = z * normalize(vec3(I + I, 0.0) - iResolution.xyy);
    p.xy *= mat2(cos((z + t) * 0.1 + vec4(0, 33, 11, 0)));
    p.z -= 5.0 * t;
    float d = 1.0;
    for (int octave = 0; octave < 7; ++octave) {
      p += cos(p.yzx * d + t) / d;
      d /= 0.7;
    }
    d = 0.02 + abs(2.0 - dot(cos(p), sin(p.yzx * 0.6))) / 8.0;
    z += d;
    O += vec4(z / 7.0, 2, 3, 1) / d;
  }
  O = scrnsvrTanh(O * O / 1e7);
}`),
  },
  {
    match: (item) => item.id === 'shadersaver-waveform',
    apply: (body) => replaceMain(body, `void mainImage(out vec4 O, vec2 I) {
  float z = 0.0;
  O = vec4(0.0);
  for (int step = 0; step < 90; ++step) {
    vec3 p = z * normalize(vec3(I + I, 0.0) - iResolution.xyy);
    p += 1.0;
    float r = max(-p, 0.0).y;
    p.y += r + r;
    float d = 1.0;
    for (int octave = 0; octave < 5; ++octave) {
      p.y += cos(p * d + 2.0 * iTime * cos(d) + z).x / d;
      d += d;
    }
    d = (0.1 * r + abs(p.y - 1.0) / (1.0 + r + r + r*r) + max(p.z + 3.0, -d * 0.1)) / 8.0;
    // The signed estimate can reach zero at the bright surface. Keep the
    // march moving forward and the reciprocal light contribution finite.
    d = max(d, 1e-4);
    z += d;
    O += (cos(z * 0.5 + iTime + vec4(0,2,4,3)) + 1.3) / d / max(z, 1e-4);
  }
  O = scrnsvrTanh(O / 9e2);
}`),
  },
  {
    match: (item) => item.id === 'shadersaver-simplex',
    apply: (body) => replaceMain(body, `void mainImage(out vec4 O, vec2 I) {
  float z = 0.0;
  O = vec4(0.0);
  for (int step = 0; step < 50; ++step) {
    vec3 p = z * normalize(vec3(I + I, 0.0) - iResolution.xyy);
    p.z -= iTime;
    vec3 v = cos(p) - sin(p).yzx;
    float d = 1e-4 + 0.5 * length(max(v, v.yzx * 0.2));
    z += d;
    O.rgb += (cos(p) + 1.2) / d;
  }
  O /= O + 1e3;
}`),
  },
  {
    match: (item) => item.id === 'shadersaver-rainbow-road',
    apply: (body) => replaceMain(body, `void mainImage(out vec4 O, vec2 I) {
  vec2 r = iResolution.xy;
  O = vec4(0.0);
  float start = fract(-iTime);
  for (int bar = 0; bar < 50; ++bar) {
    float i = start + float(bar) * 0.5;
    vec2 o = (I + I - r) / r.y * i + cos(i * vec2(0.8, 0.5) + iTime);
    O += (cos(i + vec4(0,2,4,0)) + 1.0) / max(i*i, 5.0) * 0.1
      / (i / 1e3 + length(o - vec2(clamp(o.x, -4.0, 4.0), i + o.y * sin(i) * 0.1 - 4.0)) / max(i, 1e-3));
  }
}`),
  },
  {
    match: (item) => item.id === 'shadersaver-water-ripples',
    apply: (body) => body.replace('fragColor = vec4(col*col,1);', 'fragColor = vec4(col * col * vec3(0.72, 0.9, 1.08), 1.0);'),
  },
  {
    match: (item) => item.id === 'shadersaver-starship',
    apply: (body) => body.replace(
      /texture\(iChannel0, p\/exp\(W\.x\)\+vec2\(i,t\)\/8\.\)\*40\./,
      '(0.5 + 0.5 * sin(dot(p/exp(W.x)+vec2(i,t)/8., vec2(12.9898, 78.233)))) * 40.',
    ),
  },
];

function applyAdapterRules(body, item) {
  let next = body;
  for (const rule of ADAPTER_RULES) if (rule.match(item)) next = rule.apply(next);
  return next;
}

/** Wrap the adapted body in the module scaffold that exposes it as a scrnsvr shader. */
export function emitModule(body, compatibility, item) {
  const hasMain = /\bvoid\s+main\s*\(/.test(body);
  const prepared = hasMain ? body.replace(/\bvoid\s+main\s*\(/, 'void scrnsvrImportedMain(') : body;
  const invoke = hasMain
    ? '  scrnsvrImportedMain();'
    : '  vec4 importedColor = vec4(0.0);\n  mainImage(importedColor, gl_FragCoord.xy);\n  gl_FragColor = importedColor;';
  return `// Ported from ${item.collection}/${item.file}; original notices are preserved below.\n` +
`precision highp float;\n\n` +
`uniform float uTime;\n` +
`uniform vec2 uResolution;\n` +
`uniform float speed;\n` +
`uniform float contrast;\n` +
`uniform float brightness;\n` +
`uniform float saturation;\n` +
`${controlDeclarations(item)}` +
`${compatibility.join('\n')}\n\n` +
`float scrnsvrTanh(float value) { float e = exp(clamp(2.0 * value, -40.0, 40.0)); return (e - 1.0) / (e + 1.0); }\n` +
`vec2 scrnsvrTanh(vec2 value) { return vec2(scrnsvrTanh(value.x), scrnsvrTanh(value.y)); }\n` +
`vec3 scrnsvrTanh(vec3 value) { return vec3(scrnsvrTanh(value.x), scrnsvrTanh(value.y), scrnsvrTanh(value.z)); }\n` +
`vec4 scrnsvrTanh(vec4 value) { return vec4(scrnsvrTanh(value.x), scrnsvrTanh(value.y), scrnsvrTanh(value.z), scrnsvrTanh(value.w)); }\n\n` +
`${prepared.trim()}\n\n` +
`void main() {\n${invoke}\n` +
paletteApplication +
`  vec3 color = (gl_FragColor.rgb - 0.5) * contrast + 0.5;\n` +
`  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));\n` +
`  gl_FragColor = vec4(mix(vec3(luminance), color, saturation) * brightness, 1.0);\n` +
`}\n`;
}

export function adapt(source, item) {
  const compatibility = compatibilityDefines(source, item);
  const body = applyEffectControls(applyAdapterRules(stripPreamble(source), item), item);
  return emitModule(body, compatibility, item);
}

export function manifestSource(item) {
  const symbol = symbolFor(item.id);
  return `import { manifest } from '../../../shared/manifest';\n\n` +
`export const ${symbol} = manifest({\n` +
`  id: ${JSON.stringify(item.id)},\n` +
`  title: ${JSON.stringify(item.title)},\n` +
`  category: ${JSON.stringify(item.category)},\n` +
`  description: ${JSON.stringify(`Imported from ${item.collection}; original shader notices are preserved in the source.`)},\n` +
`  fragment: 'shader.glsl',\n` +
`  schemePalette: 'custom',\n` +
`  uniforms: [\n` +
`    { name: 'speed', type: 'float', default: 1, min: 0, max: 3, step: 0.01, label: 'Speed', description: 'Overall animation speed; zero freezes movement.', group: 'Motion', random: { min: 0.35, max: 1.4 } },\n` +
`    { name: 'contrast', type: 'float', default: 1, min: 0.25, max: 2, step: 0.01, label: 'Contrast', description: 'Contrast applied to the imported composition.', group: 'Shape', random: { min: 0.7, max: 1.35 } },\n` +
`    { name: 'brightness', type: 'float', default: 1, min: 0, max: 2, step: 0.01, label: 'Brightness', description: 'Overall light intensity.', group: 'Color', random: { min: 0.65, max: 1.25 } },\n` +
`    { name: 'saturation', type: 'float', default: 1, min: 0, max: 2, step: 0.01, label: 'Saturation', description: 'Color intensity; zero is grayscale.', group: 'Color', random: { min: 0.55, max: 1.35 } },\n` +
importedControls(item).map(def => `    ${JSON.stringify(def)},\n`).join('') +
`  ],\n` +
`});\n`;
}
