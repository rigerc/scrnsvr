import { manifest } from '../../../shared/manifest';

export const gradientDriftManifest = manifest({
  id: 'gradient-drift',
  title: 'Gradient Drift',
  description: 'Wide, silky bands of color that slowly turn and drift.',
  fragment: 'shader.glsl',
  uniforms: [
    { name: 'speed', type: 'float', default: 0.3, min: 0, max: 2 },
    { name: 'scale', type: 'float', default: 1, min: 0.3, max: 3 },
    { name: 'warp', type: 'float', default: 0.35, min: 0, max: 1 },
    { name: 'shadow', type: 'color', default: '#29216b' },
    { name: 'midtone', type: 'color', default: '#e779aa' },
    { name: 'highlight', type: 'color', default: '#ffd6a0' },
  ],
});
