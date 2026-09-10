import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const root = 'src/renderer/shaders';
const imported = readdirSync(root, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && /^(avs|shadersaver)-/.test(entry.name))
  .map(entry => entry.name)
  .sort();

describe('imported shader collection', () => {
  it('contains all compatible upstream screensaver effects', () => {
    expect(imported.filter(id => id.startsWith('avs-'))).toHaveLength(18);
    expect(imported.filter(id => id.startsWith('shadersaver-'))).toHaveLength(10);
    expect(imported).not.toContain('avs-warp');
  });

  it.each(imported)('%s keeps provenance and standard controls', id => {
    const shader = readFileSync(`${root}/${id}/shader.glsl`, 'utf8');
    const manifest = readFileSync(`${root}/${id}/manifest.ts`, 'utf8');
    expect(shader).toMatch(/^\/\/ Ported from (AVS|ShaderSaver)\//);
    for (const name of ['speed', 'contrast', 'brightness', 'saturation']) {
      expect(shader).toContain(`uniform float ${name};`);
      expect(manifest).toContain(`name: '${name}'`);
    }
  });
});
