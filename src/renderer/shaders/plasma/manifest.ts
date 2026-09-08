import { manifest } from '../../../shared/manifest';

export const plasmaManifest = manifest({
  id: 'plasma',
  title: 'Chromatic Plasma',
  fragment: 'shader.glsl',
  uniforms: [
    { name: 'speed', type: 'float', default: 0.65, min: 0, max: 3 },
    { name: 'scale', type: 'float', default: 3.5, min: 0.5, max: 12 },
    { name: 'contrast', type: 'float', default: 1.15, min: 0.25, max: 2.5 },
    { name: 'palette', type: 'select', default: 'neon', options: ['neon', 'sunset', 'ice'] },
  ],
});
