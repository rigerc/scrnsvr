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
import { opalFilmManifest } from '../src/renderer/shaders/opal-film/manifest';
import { kineticTilesManifest } from '../src/renderer/shaders/kinetic-tiles/manifest';
import { inkBloomManifest } from '../src/renderer/shaders/ink-bloom/manifest';
import { phosphorGardenManifest } from '../src/renderer/shaders/phosphor-garden/manifest';
import { rainGlassManifest } from '../src/renderer/shaders/rain-glass/manifest';
import { guillocheManifest } from '../src/renderer/shaders/guilloche/manifest';
import { liquidChromeManifest } from '../src/renderer/shaders/liquid-chrome/manifest';
import { prismMosaicManifest } from '../src/renderer/shaders/prism-mosaic/manifest';
import { paperLanternsManifest } from '../src/renderer/shaders/paper-lanterns/manifest';
import { magneticFilamentsManifest } from '../src/renderer/shaders/magnetic-filaments/manifest';
import { pulseRingsManifest } from '../src/renderer/shaders/reactive-pulse-rings/manifest';
import { audioRibbonsManifest } from '../src/renderer/shaders/reactive-audio-ribbons/manifest';
import { bassBloomManifest } from '../src/renderer/shaders/reactive-bass-bloom/manifest';

import { chromaticOverlapManifest } from '../src/renderer/shaders/chromatic-overlap/manifest';
import { quietArchesManifest } from '../src/renderer/shaders/quiet-arches/manifest';
import { tidalCutoutsManifest } from '../src/renderer/shaders/tidal-cutouts/manifest';
import { eclipseStudyManifest } from '../src/renderer/shaders/eclipse-study/manifest';
import { colorMobileManifest } from '../src/renderer/shaders/color-mobile/manifest';
import { softApertureManifest } from '../src/renderer/shaders/soft-aperture/manifest';
import { gradientLoomManifest } from '../src/renderer/shaders/gradient-loom/manifest';
import { petalHoursManifest } from '../src/renderer/shaders/petal-hours/manifest';
import { pebbleAtlasManifest } from '../src/renderer/shaders/pebble-atlas/manifest';
import { floatingWindowsManifest } from '../src/renderer/shaders/floating-windows/manifest';
import { paperFansManifest } from '../src/renderer/shaders/paper-fans/manifest';
import { islandHoursManifest } from '../src/renderer/shaders/island-hours/manifest';
import { tangramTideManifest } from '../src/renderer/shaders/tangram-tide/manifest';
import { colorEstuaryManifest } from '../src/renderer/shaders/color-estuary/manifest';
import { quietPleatsManifest } from '../src/renderer/shaders/quiet-pleats/manifest';

const manifests = [auroraVeilManifest, contourDunesManifest, emberDriftManifest, flowFieldManifest, gradientBlobsManifest, gradientDriftManifest, interferenceManifest, meshGradientManifest, plasmaManifest, silkRibbonsManifest, starDriftManifest, tidalCausticsManifest,
  opalFilmManifest, kineticTilesManifest, inkBloomManifest, phosphorGardenManifest, rainGlassManifest,
  guillocheManifest, liquidChromeManifest, prismMosaicManifest, paperLanternsManifest, magneticFilamentsManifest,
  pulseRingsManifest, audioRibbonsManifest, bassBloomManifest,
  chromaticOverlapManifest, quietArchesManifest, tidalCutoutsManifest, eclipseStudyManifest, colorMobileManifest, softApertureManifest, gradientLoomManifest, petalHoursManifest, pebbleAtlasManifest, floatingWindowsManifest, paperFansManifest, islandHoursManifest, tangramTideManifest, colorEstuaryManifest, quietPleatsManifest];

type Manifest = (typeof manifests)[number];

function assertUniformContracts(manifest: Manifest) {
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
      // A dependency value that does not match its parent's type can never be
      // satisfied, which silently hides the control forever.
      if (parent.type === 'select') expect(parent.options).toContain(def.visibleWhen.value);
      else if (parent.type === 'bool') expect(typeof def.visibleWhen.value).toBe('boolean');
      else expect(typeof def.visibleWhen.value).toBe('number');
    }
  }
}

function assertRandomization(manifest: Manifest) {
  for (const random of [0, 0.2, 0.5, 0.9, 1]) {
    const values = randomizeUniforms(manifest.uniforms, {}, () => random);
    // Randomize stores eligible overrides only: inherited scheme colors stay
    // absent so later scheme changes still flow through.
    const stored = manifest.uniforms.filter(def => Object.hasOwn(values, def.name));
    expect(Object.keys(values).every(name => manifest.uniforms.some(def => def.name === name))).toBe(true);
    expect(bindUniforms(stored, values)).toEqual(values);
    for (const def of stored) {
      const value = values[def.name];
      if (typeof value !== 'number') continue;
      expect(Number.isFinite(value)).toBe(true);
      expect(snapUniformValue(def, value)).toBe(value);
      if (def.random) {
        expect(value).toBeGreaterThanOrEqual(def.random.min);
        expect(value).toBeLessThanOrEqual(def.random.max);
      }
    }
  }
}

describe('shader parameter contracts', () => {
  for (const manifest of manifests) {
    it(`${manifest.id} exposes typed, labeled controls with valid defaults and random ranges`, () => {
      assertUniformContracts(manifest);
      assertRandomization(manifest);
    });
  }
});
