import { manifest } from '../../../shared/manifest';

export const meshGradientManifest = manifest({
  id: 'mesh-gradient',
  title: 'Mesh Gradient',
  description: 'Four floating pools of color blend into a soft, shifting mesh.',
  fragment: 'shader.glsl',
  uniforms: [
    { name: 'speed', type: 'float', default: 0.35, min: 0, max: 2 },
    { name: 'blend', type: 'float', default: 0.5, min: 0.1, max: 1 },
    { name: 'warp', type: 'float', default: 0.45, min: 0, max: 1 },
    { name: 'color1', type: 'color', default: '#7051ef' },
    { name: 'color2', type: 'color', default: '#ff8bb3' },
    { name: 'color3', type: 'color', default: '#45dfcf' },
    { name: 'color4', type: 'color', default: '#ffc480' },
  ],
});
