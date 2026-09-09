import { manifest } from '../../../shared/manifest';

export const starDriftManifest = manifest({
  id: 'star-drift',
  title: 'Star Drift',
  description: 'Layers of softly glowing stars glide through a deep night sky.',
  fragment: 'shader.glsl',
  uniforms: [
    { name: 'speed', type: 'float', default: 0.3, min: 0, max: 2 },
    { name: 'density', type: 'float', default: 1, min: 0.4, max: 2 },
    { name: 'twinkle', type: 'float', default: 0.3, min: 0, max: 1 },
    { name: 'brightness', type: 'float', default: 1, min: 0, max: 2 },
    { name: 'color1', type: 'color', default: '#a9d6ff' },
    { name: 'color2', type: 'color', default: '#ffe3bd' },
  ],
});
