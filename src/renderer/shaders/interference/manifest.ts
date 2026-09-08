import { manifest } from '../../../shared/manifest';

export const interferenceManifest = manifest({
  id: 'interference',
  title: 'Orbital Interference',
  fragment: 'shader.glsl',
  uniforms: [
    { name: 'speed', type: 'float', default: 0.35, min: 0, max: 2 },
    { name: 'rings', type: 'int', default: 18, min: 3, max: 48 },
    { name: 'softness', type: 'float', default: 0.09, min: 0.01, max: 0.3 },
    { name: 'invert', type: 'bool', default: false },
    { name: 'color', type: 'color', default: '#9d7cff' },
  ],
});
