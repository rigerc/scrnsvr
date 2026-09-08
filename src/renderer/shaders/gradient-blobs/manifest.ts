import { manifest } from '../../../shared/manifest';

export const gradientBlobsManifest = manifest({
  id: 'gradient-blobs',
  title: 'Gradient Blobs',
  description: 'Glowing gradient blobs float, merge, and gently pull apart.',
  fragment: 'shader.glsl',
  uniforms: [
    { name: 'speed', type: 'float', default: 0.4, min: 0, max: 2 },
    { name: 'size', type: 'float', default: 0.19, min: 0.08, max: 0.35 },
    { name: 'softness', type: 'float', default: 0.45, min: 0.05, max: 1 },
    { name: 'count', type: 'int', default: 5, min: 2, max: 8 },
    { name: 'color1', type: 'color', default: '#9f63ff' },
    { name: 'color2', type: 'color', default: '#ff719a' },
    { name: 'color3', type: 'color', default: '#50dbe8' },
    { name: 'background', type: 'color', default: '#0b1029' },
  ],
});
