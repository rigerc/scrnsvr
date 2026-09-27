import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fallbackLiteral, glslType } from '../scripts/lib/canonical-shader.mjs';
import type { ShaderManifest } from '../src/shared/manifest';

const root = 'src/renderer/shaders';
const ids = readdirSync(root, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort();

/** Strip comments so a commented-out `mainImage`/`main` cannot satisfy the shape checks. */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

function parseBlock(source: string) {
  const match = /#ifdef SCRNSVR([\s\S]*?)#else([\s\S]*?)#endif/.exec(source);
  if (!match) throw new Error('Missing SCRNSVR block');
  const constants = new Map<string, { type: string; literal: string }>();
  for (const entry of match[2].matchAll(/const\s+(\w+)\s+(\w+)\s*=\s*([^;]+);/g)) {
    constants.set(entry[2], { type: entry[1], literal: entry[3].trim() });
  }
  return { declarations: match[1], constants };
}

const manifestModules = import.meta.glob('../src/renderer/shaders/*/manifest.ts', { eager: true }) as Record<string, Record<string, unknown>>;

function manifestFor(id: string): ShaderManifest {
  const module_ = manifestModules[`../${root}/${id}/manifest.ts`];
  const manifest = Object.values(module_ ?? {}).find(value => value && typeof value === 'object' && 'uniforms' in value) as ShaderManifest | undefined;
  if (!manifest) throw new Error(`No manifest export in ${id}`);
  return manifest;
}

describe('canonical shader ABI', () => {
  it('covers every built-in folder', () => {
    expect(ids.length).toBe(53);
  });

  it.each(ids)('%s is a mainImage source with manifest-matched Shadereye fallbacks', id => {
    const source = readFileSync(`${root}/${id}/shader.glsl`, 'utf8');
    const code = stripComments(source);

    // One real fragment entry point, no scrnsvr vertex-shader dependency.
    expect(code).toMatch(/void\s+mainImage\s*\(/);
    expect(code).not.toMatch(/void\s+main\s*\(/);
    expect(code).not.toMatch(/\bvarying\b/);
    expect(code).not.toMatch(/\bgl_FragColor\b/);
    // No upstream compatibility shims that would collide with Shadereye's names.
    expect(code).not.toMatch(/#define\s+(iTime|time|iResolution|resolution|iMouse|iTimeDelta|iFrame|iDate)\b/);

    expect(source).toContain('#define uTime iTime');
    expect(source).toContain('#define uResolution iResolution.xy');

    const manifest = manifestFor(id);
    const { declarations, constants } = parseBlock(source);
    for (const definition of manifest.uniforms) {
      expect(declarations).toContain(`uniform ${glslType(definition)} ${definition.name};`);
      const fallback = constants.get(definition.name);
      expect(fallback, `${id} is missing the ${definition.name} fallback`).toBeTruthy();
      expect(fallback!.type).toBe(glslType(definition));
      expect(fallback!.literal, `${id}.${definition.name} fallback drifted from the manifest`).toBe(fallbackLiteral(definition));
    }

    if (/\buAudio\b/.test(code)) expect(constants.get('uAudio')?.literal).toBe('vec4(0.0)');
    if (/\buDate\b/.test(code)) expect(constants.get('uDate')).toBeTruthy();
  });
});
