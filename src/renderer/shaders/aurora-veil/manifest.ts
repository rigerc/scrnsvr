import { manifest } from '../../../shared/manifest';

export const auroraVeilManifest = manifest({
  id: 'aurora-veil',
  title: 'Aurora Veil',
  description: 'Translucent ribbons of light ripple across a midnight gradient.',
  fragment: 'shader.glsl',
  uniforms: [
    { name: 'speed', type: 'float', default: 0.3, min: 0, max: 2 },
    { name: 'waves', type: 'float', default: 1.5, min: 0.5, max: 4 },
    { name: 'spread', type: 'float', default: 0.45, min: 0.1, max: 1 },
    { name: 'brightness', type: 'float', default: 1, min: 0.2, max: 2 },
    { name: 'color1', type: 'color', default: '#38e8ba' },
    { name: 'color2', type: 'color', default: '#9270ff' },
  ],
});
