import { manifest } from '../../../shared/manifest';

export const silkRibbonsManifest = manifest({
  id: 'silk-ribbons',
  title: 'Silk Ribbons',
  description: 'Pearlescent bands of rose and blue silk unfurl in the dark.',
  fragment: 'shader.glsl',
  uniforms: [
    { name: 'speed', type: 'float', default: 0.25, min: 0, max: 2 },
    { name: 'width', type: 'float', default: 0.55, min: 0.1, max: 1 },
    { name: 'sway', type: 'float', default: 0.6, min: 0, max: 1 },
    { name: 'brightness', type: 'float', default: 1, min: 0, max: 2 },
    { name: 'color1', type: 'color', default: '#ea91b7' },
    { name: 'color2', type: 'color', default: '#779de8' },
  ],
});
