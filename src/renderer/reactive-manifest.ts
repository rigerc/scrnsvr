import { manifest } from '../shared/manifest';

// Keep the original IDs and control ranges so existing selections and presets survive.
export const reactiveManifest = (id: string, title: string, description: string, palette: [string, string, string]) => manifest({
  id, title, description, category: 'Reactive', fragment: 'shader.glsl',
  uniforms: [
    { name: 'speed', type: 'float', default: 0.4, min: 0, max: 3, step: 0.01, group: 'Motion', label: 'Speed', description: 'Slow ambient drift. Audio response continues at zero.', random: { min: 0.2, max: 0.6 } },
    { name: 'sensitivity', type: 'float', default: 1, min: 0, max: 4, step: 0.01, group: 'Motion', label: 'Audio influence', description: 'How strongly light and shapes follow the music, with a smooth fade between accents; zero disables it.', random: { min: 0.5, max: 1.5 } },
    { name: 'scale', type: 'float', default: 1, min: 0.3, max: 3, step: 0.01, group: 'Shape', label: 'Scale', description: 'Size of the composition; lower values bring it closer.', random: { min: 0.7, max: 1.3 } },
    { name: 'brightness', type: 'float', default: 1, min: 0, max: 2, step: 0.01, group: 'Color', label: 'Brightness', description: 'Overall light intensity.', random: { min: 0.7, max: 1.1 } },
    { name: 'color1', type: 'color', default: palette[0], group: 'Color', label: 'Primary color', description: 'Main light or material color.' },
    { name: 'color2', type: 'color', default: palette[1], group: 'Color', label: 'Secondary color', description: 'Complementary light or haze color.' },
    { name: 'background', type: 'color', default: palette[2], group: 'Color', label: 'Background', description: 'The quiet space behind the composition.', random: false },
    { name: 'saturation', type: 'float', default: 1, min: 0, max: 2, step: 0.01, group: 'Color', label: 'Saturation', description: 'Color intensity; zero is grayscale.', advanced: true, random: { min: 0.7, max: 1.1 } },
  ],
});
