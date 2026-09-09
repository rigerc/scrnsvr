import { manifest } from '../../../shared/manifest';

export const emberDriftManifest = manifest({
  id: 'ember-drift',
  title: 'Ember Drift',
  description: 'Warm motes rise and softly fade against a smoky night.',
  fragment: 'shader.glsl',
  uniforms: [
    { name: 'speed', type: 'float', default: 0.3, min: 0, max: 2 },
    { name: 'density', type: 'float', default: 0.7, min: 0.1, max: 1 },
    { name: 'glow', type: 'float', default: 0.5, min: 0, max: 1 },
    { name: 'brightness', type: 'float', default: 1, min: 0, max: 2 },
    { name: 'color1', type: 'color', default: '#ff9b48' },
    { name: 'color2', type: 'color', default: '#ffd99a' },
  ],
});
