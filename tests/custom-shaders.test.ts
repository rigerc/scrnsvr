import { describe, expect, it } from 'vitest';
import { ConfigSchema } from '../src/shared/config';
import { customShaderDefinition, customShaderTemplate, withCustomShaders } from '../src/shared/custom-shaders';
import { pickRotationEntry } from '../src/shared/rotation';

const shader = { id: 'custom-example', title: 'Example', source: customShaderTemplate };
describe('saved user shaders', () => {
  it('migrates old config and roundtrips source and rotation', () => {
    expect(ConfigSchema.parse({}).customShaders).toEqual([]);
    const config = ConfigSchema.parse(JSON.parse(JSON.stringify({ customShaders: [shader], shader: shader.id,
      rotation: { enabled: true, entries: [{ shader: shader.id }], intervalMinutes: 1 } })));
    expect(config.customShaders).toEqual([shader]);
    const registry = withCustomShaders({}, config.customShaders);
    expect(pickRotationEntry(config.rotation, {}, {}, Object.keys(registry))?.shaderId).toBe(shader.id);
  });
  it('rejects collisions, duplicate IDs, empty titles and oversized sources', () => {
    for (const customShaders of [[{ ...shader, id: 'plasma' }], [shader, shader], [{ ...shader, title: ' ' }], [{ ...shader, source: 'x'.repeat(100001) }]]) {
      expect(ConfigSchema.safeParse({ customShaders }).success).toBe(false);
    }
  });
  it('adapts raw GLSL uniforms and keeps a single entry point', () => {
    const result = customShaderDefinition({ ...shader, source: 'precision mediump float; uniform float uTime; void main(){gl_FragColor=vec4(uTime);}' });
    expect(result.source.match(/uniform float uTime;/g)).toHaveLength(1);
    expect(result.source.match(/void main\(/g)).toHaveLength(1);
    expect(result.source).toContain('customMain();');
  });
  it('rejects unsupported inputs with actionable errors', () => {
    for (const source of ['#version 300 es\nvoid main(){}', 'uniform sampler2D tex; void main(){}', 'uniform float unknown; void main(){}', 'nothing']) {
      expect(() => customShaderDefinition({ ...shader, source })).toThrow();
    }
  });
});
