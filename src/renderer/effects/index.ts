import { effectManifests, type EffectDefinition } from '../../shared/effects';
import vhsSource from './vhs-distortion.glsl';
import { advancedEffectRegistry } from './advanced';
import { additionalEffectRegistry } from './catalog';

export const effectRegistry: Record<string, EffectDefinition> = {
  'vhs-distortion': { ...effectManifests['vhs-distortion'], source: vhsSource },
  ...additionalEffectRegistry,
  ...advancedEffectRegistry,
};
