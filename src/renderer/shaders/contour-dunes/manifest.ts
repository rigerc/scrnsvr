import { manifest } from '../../../shared/manifest';

export const contourDunesManifest = manifest({
  id: 'contour-dunes',
  title: 'Contour Dunes',
  description: 'Copper and indigo contour lines flow like wind-shaped dunes.',
  fragment: 'shader.glsl',
  uniforms: [
    { name: 'speed', type: 'float', default: 0.2, min: 0, max: 2 },
    { name: 'scale', type: 'float', default: 1, min: 0.4, max: 3 },
    { name: 'lines', type: 'float', default: 10, min: 4, max: 20 },
    { name: 'brightness', type: 'float', default: 1, min: 0, max: 2 },
    { name: 'color1', type: 'color', default: '#192744' },
    { name: 'color2', type: 'color', default: '#d6a06b' },
  ],
});
