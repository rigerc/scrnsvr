// Canonical built-in shader ABI helpers.
//
// Every checked-in `src/renderer/shaders/<id>/shader.glsl` is a Shadertoy /
// shadereye `mainImage` source: its `#ifdef SCRNSVR` block declares the engine
// and manifest uniforms, and its `#else` branch carries manifest-default
// constants so the same file renders in Shadereye. This module derives the
// expected GLSL type and default literal from a manifest so the two halves
// cannot drift. `tests/canonical-shader.test.ts` is the only consumer.

const GL_TYPE = { float: 'float', int: 'int', bool: 'bool', color: 'vec3', select: 'int' };

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
