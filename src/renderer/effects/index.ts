import { effectManifests, type EffectDefinition } from '../../shared/effects';
import vhsSource from './vhs-distortion.glsl';

export const effectRegistry: Record<string, EffectDefinition> = {
  'vhs-distortion': { ...effectManifests['vhs-distortion'], source: vhsSource },
};
