import { effectManifests, type EffectDefinition } from '../../shared/effects';
import extract from './bloom-extract.glsl';
import horizontal from './bloom-horizontal.glsl';
import vertical from './bloom-vertical.glsl';
import combine from './bloom-combine.glsl';
import trails from './datamosh-trails.glsl';

export const advancedEffectRegistry: Record<string, EffectDefinition> = {
  bloom: { ...effectManifests.bloom, passes: [extract, horizontal, vertical], source: combine },
  'datamosh-trails': { ...effectManifests['datamosh-trails'], history: true, source: trails },
};
