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

describe('imported expressive control contracts', () => {
  it.each(imported)('%s exposes only wired, typed custom colors and controls', async id => {
    const { importedControls } = await import('../scripts/lib/upstream-controls.mjs');
    const source = readFileSync(`${root}/${id}/shader.glsl`, 'utf8');
    const manifest = readFileSync(`${root}/${id}/manifest.ts`, 'utf8');
    const controls = importedControls({ id });
    for (const control of controls) {
      const type = control.type === 'select' ? 'int' : control.type === 'color' ? 'vec3' : control.type;
      expect(source).toContain(`uniform ${type} ${control.name};`);
      expect(manifest).toContain(`"name":"${control.name}"`);
      // A declaration alone is insufficient: every exposed control must be read.
      expect(source.match(new RegExp(`\\b${control.name}\\b`, 'g'))!.length).toBeGreaterThan(1);
      if (control.type === 'color') {
        expect(control.visibleWhen).toEqual({ name: 'palette', value: 'custom' });
        expect(control.colorRole).toBeTruthy();
      }
      if (control.type === 'float') {
        expect(control.default).toBeGreaterThanOrEqual(control.min!);
        expect(control.default).toBeLessThanOrEqual(control.max!);
      }
    }
  });
});
