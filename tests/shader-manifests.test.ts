import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { bindUniforms, randomizeUniforms, snapUniformValue } from '../src/renderer/core/uniforms';
import { auroraVeilManifest } from '../src/renderer/shaders/aurora-veil/manifest';
import { contourDunesManifest } from '../src/renderer/shaders/contour-dunes/manifest';
import { emberDriftManifest } from '../src/renderer/shaders/ember-drift/manifest';
import { flowFieldManifest } from '../src/renderer/shaders/flow-field/manifest';
import { gradientBlobsManifest } from '../src/renderer/shaders/gradient-blobs/manifest';
import { gradientDriftManifest } from '../src/renderer/shaders/gradient-drift/manifest';
import { interferenceManifest } from '../src/renderer/shaders/interference/manifest';
import { meshGradientManifest } from '../src/renderer/shaders/mesh-gradient/manifest';
import { plasmaManifest } from '../src/renderer/shaders/plasma/manifest';
import { silkRibbonsManifest } from '../src/renderer/shaders/silk-ribbons/manifest';
import { starDriftManifest } from '../src/renderer/shaders/star-drift/manifest';
import { tidalCausticsManifest } from '../src/renderer/shaders/tidal-caustics/manifest';

const manifests = [auroraVeilManifest, contourDunesManifest, emberDriftManifest, flowFieldManifest, gradientBlobsManifest, gradientDriftManifest, interferenceManifest, meshGradientManifest, plasmaManifest, silkRibbonsManifest, starDriftManifest, tidalCausticsManifest];

describe('shader parameter contracts', () => {
  for (const manifest of manifests) {
    it(`${manifest.id} exposes typed, labeled controls with valid defaults and random ranges`, () => {
      const source = readFileSync(`src/renderer/shaders/${manifest.id}/shader.glsl`, 'utf8');
      expect(new Set(manifest.uniforms.map(def => def.name)).size).toBe(manifest.uniforms.length);
      expect(manifest.uniforms.map(def => def.name)).toEqual(expect.arrayContaining(['speed', 'brightness', 'saturation']));
      for (const def of manifest.uniforms) {
        expect(def.label).toBeTruthy();
        expect(def.description).toBeTruthy();
        expect(['Motion', 'Shape', 'Color']).toContain(def.group);
        const type = def.type === 'color' ? 'vec3' : def.type === 'select' ? 'int' : def.type;
        expect(source).toContain(`uniform ${type} ${def.name};`);
        expect(bindUniforms([def], {})[def.name]).toBe(def.default);
        if (def.type === 'float' || def.type === 'int') {
          expect(Number.isFinite(def.min)).toBe(true);
          expect(Number.isFinite(def.max)).toBe(true);
          expect(Number(def.step)).toBeGreaterThan(0);
          expect(def.default).toBeGreaterThanOrEqual(def.min!);
          expect(def.default).toBeLessThanOrEqual(def.max!);
          expect(snapUniformValue(def, def.default)).toBe(def.default);
        }
        if (def.visibleWhen) {
          const parent = manifest.uniforms.find(other => other.name === def.visibleWhen!.name)!;
          expect(parent).toBeDefined();
          if (parent.type === 'select') expect(parent.options).toContain(def.visibleWhen.value);
        }
      }
      for (const random of [0, 0.2, 0.5, 0.9, 1]) {
        const values = randomizeUniforms(manifest.uniforms, {}, () => random);
        expect(bindUniforms(manifest.uniforms, values)).toEqual(values);
        for (const def of manifest.uniforms) {
          if (typeof values[def.name] === 'number') {
            expect(Number.isFinite(values[def.name])).toBe(true);
            expect(snapUniformValue(def, values[def.name])).toBe(values[def.name]);
            if (def.random) {
              expect(values[def.name]).toBeGreaterThanOrEqual(def.random.min);
              expect(values[def.name]).toBeLessThanOrEqual(def.random.max);
            }
          }
        }
      }
    });
  }
});
