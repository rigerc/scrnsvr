import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const shaderRoot = 'src/renderer/shaders';

function filesUnder(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(full));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

const shaderIds = readdirSync(shaderRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name);

/** Names from the removed AVS/ShaderSaver import pipeline. None may survive anywhere in src/ or scripts/. */
const REMOVED_PIPELINE_TOKENS = [
  'import-upstream-shaders',
  'upstream-adapt',
  'upstream-controls',
  'canonicalizeImported',
  'paletteApplication',
  'IMPORTED_POST',
  'detectUpstreamCompatNames',
];

describe('upstream shader removal', () => {
  it('ships no AVS or ShaderSaver effect', () => {
    expect(shaderIds.filter(id => /^(avs|shadersaver)-/.test(id))).toEqual([]);
    expect(shaderIds).toHaveLength(40);
  });

  it('keeps no ported-source provenance header', () => {
    for (const id of shaderIds) {
      const source = readFileSync(`${shaderRoot}/${id}/shader.glsl`, 'utf8');
      expect(source, id).not.toMatch(/^\/\/ Ported from (AVS|ShaderSaver)\//);
    }
  });

  it('removes the import pipeline and its helpers', () => {
    const scanned = [...filesUnder('src'), ...filesUnder('scripts')]
      .filter(file => /\.(ts|tsx|mjs|cjs|js|glsl|html|css|json)$/.test(file))
      .map(file => [file, readFileSync(file, 'utf8')] as const);
    expect(scanned.length).toBeGreaterThan(0);
    for (const token of REMOVED_PIPELINE_TOKENS) {
      const hits = scanned.filter(([, text]) => text.includes(token)).map(([file]) => file);
      expect(hits, `leftover reference to ${token}`).toEqual([]);
    }
  });

  it('keeps only the inlined LYGIA attribution in the credits file', () => {
    const credits = readFileSync('THIRD_PARTY_SHADERS.md', 'utf8');
    expect(credits).not.toMatch(/^## (AVS|ShaderSaver|Porting notes)$/m);
    expect(credits).toMatch(/^## LYGIA simplex noise$/m);
    expect(readFileSync('README.md', 'utf8')).not.toMatch(/\bAVS\b|ShaderSaver/);
  });

  it('keeps the canonical-ABI count in step with the shader folders', () => {
    const canonical = readFileSync('tests/canonical-shader.test.ts', 'utf8');
    expect(canonical).not.toContain('toBe(53)');
    expect(canonical).toContain(`toBe(${shaderIds.length})`);
  });
});
