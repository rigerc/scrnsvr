// Canonical shader format used by every built-in in src/renderer/shaders.
//
// The checked-in shader.glsl is a Shadertoy/shader-eyre `mainImage` source. The
// runtime adds the WebGL1 `main()` and defines SCRNSVR; when Shadereye renders
// the file unchanged, SCRNSVR is undefined and the `#else` manifest defaults are
// used. This module generates both halves from the manifest so their values
// cannot drift (tests/shader-manifests.test.ts enforces that).
//
// It is used by scripts/migrate-shaders-to-mainimage.mjs (one-time conversion of
// the existing files) and by scripts/lib/upstream-adapt.mjs (future imports).

import { paletteApplication } from './upstream-controls.mjs';

const GL_TYPE = { float: 'float', int: 'int', bool: 'bool', color: 'vec3', select: 'int' };

/** Default engine uniform values for the SCRNSVR-undefined (Shadereye) branch. */
const ENGINE_FALLBACKS = {
  audio: 'const vec4 uAudio = vec4(0.0);',
  date: 'const vec4 uDate = vec4(2026.0, 9.0, 10.0, 46800.0);',
};

export const glslType = (definition) => GL_TYPE[definition.type];
const selectIndex = (definition) => Math.max(0, (definition.options ?? []).indexOf(String(definition.default)));

function formatFloat(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Unsupported float default: ${value}`);
  return Number.isInteger(number) ? `${number}.0` : String(number);
}

function formatColor(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(hex));
  if (!match) throw new Error(`Unsupported color default: ${hex}`);
  const value = Number.parseInt(match[1], 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map(channel => (channel / 255).toFixed(6));
  return `vec3(${channels.join(', ')})`;
}

export function fallbackLiteral(definition) {
  switch (definition.type) {
    case 'float': return formatFloat(definition.default);
    case 'int': return String(Math.round(Number(definition.default)));
    case 'bool': return definition.default ? 'true' : 'false';
    case 'color': return formatColor(definition.default);
    case 'select': return String(selectIndex(definition));
    default: throw new Error(`Unsupported uniform type: ${definition.type}`);
  }
}

/**
 * The `#ifdef SCRNSVR` uniform block plus its `#else` manifest-default fallbacks.
 * The block is what makes a single file render in both scrnsvr and Shadereye.
 */
function canonicalUniformBlock(uniforms, { audio = false, date = false } = {}) {
  const declarations = [
    'uniform float uTime;',
    'uniform vec2 uResolution;',
    ...(audio ? ['uniform vec4 uAudio;'] : []),
    ...(date ? ['uniform vec4 uDate;'] : []),
    ...uniforms.map(definition => `uniform ${glslType(definition)} ${definition.name};`),
  ];
  const fallbacks = [
    '#define uTime iTime',
    '#define uResolution iResolution.xy',
    ...(audio ? [ENGINE_FALLBACKS.audio] : []),
    ...(date ? [ENGINE_FALLBACKS.date] : []),
    ...uniforms.map(definition => `const ${glslType(definition)} ${definition.name} = ${fallbackLiteral(definition)};`),
  ];
  return `#ifdef SCRNSVR\n${declarations.join('\n')}\n#else\n${fallbacks.join('\n')}\n#endif`;
}

function tidy(text) {
  return text.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '\n');
}

export function canonicalSource(header, body, uniforms, engine) {
  return `${header}precision highp float;\n\n${canonicalUniformBlock(uniforms, engine)}\n\n${tidy(body)}`;
}

/** Locate a top-level function by name and return its exact source text. */
export function extractFunction(source, name) {
  const pattern = new RegExp(`(?:^|\\n)[ \\t]*(?:void|float|vec2|vec3|vec4|bool|int|mat2|mat3|mat4)\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const match = pattern.exec(source);
  if (!match) return null;
  const start = match.index + (match[0].startsWith('\n') ? 1 : 0);
  const open = source.indexOf('{', match.index);
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === '{') depth++;
    else if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed function ${name}`);
}

/** Replace the upstream names a compatibility `#define` provided with canonical expressions. */
export function normalizeCompatTokens(text, defined) {
  const has = (name) => defined.has(name);
  let out = text;
  if (has('iTimeDelta')) out = out.replace(/\biTimeDelta\b/g, '(1.0 / 60.0)');
  if (has('iFrame')) out = out.replace(/\biFrame\b/g, 'int(floor(uTime * 60.0))');
  if (has('iDate')) out = out.replace(/\biDate\b/g, 'vec4(uDate.xyz, mod(uDate.w + uTime * speed, 86400.0))');
  if (has('iMouse')) out = out.replace(/\biMouse\b/g, 'vec4(0.0)');
  if (has('iTime')) out = out.replace(/\biTime\b/g, 'uTime * speed');
  if (has('time')) out = out.replace(/\btime\b/g, 'uTime * speed');
  if (has('iResolution')) {
    out = out
      .replace(/\biResolution\.xyy\b/g, 'vec3(uResolution, uResolution.y)')
      .replace(/\biResolution\.xy\b/g, 'uResolution')
      .replace(/\biResolution\.x\b/g, 'uResolution.x')
      .replace(/\biResolution\.y\b/g, 'uResolution.y')
      .replace(/\biResolution\b/g, 'vec3(uResolution, 1.0)');
  }
  if (has('resolution')) {
    out = out
      .replace(/\bresolution\.xy\b/g, 'uResolution')
      .replace(/\bresolution\.x\b/g, 'uResolution.x')
      .replace(/\bresolution\.y\b/g, 'uResolution.y')
      .replace(/\bresolution\b/g, 'uResolution');
  }
  return out;
}

const IMPORTED_POST = `${paletteApplication}  vec3 color = (gl_FragColor.rgb - 0.5) * contrast + 0.5;
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(mix(vec3(luminance), color, saturation) * brightness, 1.0);
`;
export { IMPORTED_POST };

/** Compatibility names an upstream source needs normalized, from its declarations and Shadertoy names. */
export function detectUpstreamCompatNames(source, collection) {
  const names = new Set();
  const declared = (name) => new RegExp(`uniform\\s+[^;]+\\s+${name}\\s*;`).test(source);
  const uses = (name) => new RegExp(`\\b${name}\\b`).test(source);
  for (const name of ['iTime', 'time', 'iResolution', 'resolution', 'iMouse', 'iTimeDelta', 'iFrame', 'iDate']) {
    if (declared(name)) names.add(name);
  }
  for (const name of ['iTime', 'iResolution', 'iMouse', 'iTimeDelta', 'iFrame', 'iDate']) {
    if (uses(name)) names.add(name);
  }
  if (collection === 'ShaderSaver' && uses('iTime')) names.add('iTime');
  return names;
}
