import { manifest } from '../../../shared/manifest';

export const tidalCausticsManifest = manifest({
  id: 'tidal-caustics',
  title: 'Tidal Caustics',
  description: 'Soft pools of refracted light wander across a tranquil seabed.',
  fragment: 'shader.glsl',
  uniforms: [
    { name: 'speed', type: 'float', default: 0.25, min: 0, max: 2 },
    { name: 'scale', type: 'float', default: 1, min: 0.4, max: 3 },
    { name: 'focus', type: 'float', default: 0.5, min: 0, max: 1 },
    { name: 'brightness', type: 'float', default: 1, min: 0, max: 2 },
    { name: 'color1', type: 'color', default: '#06394d' },
    { name: 'color2', type: 'color', default: '#71e5d0' },
  ],
});
