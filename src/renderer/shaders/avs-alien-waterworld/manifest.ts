import { manifest } from '../../../shared/manifest';

export const avsAlienWaterworldManifest = manifest({
  id: "avs-alien-waterworld",
  title: "Alien Waterworld",
  category: "Landscapes",
  description: "Imported from AVS; original shader notices are preserved in the source.",
  fragment: 'shader.glsl',
  schemePalette: 'custom',
  uniforms: [
    { name: 'speed', type: 'float', default: 1, min: 0, max: 3, step: 0.01, label: 'Speed', description: 'Overall animation speed; zero freezes movement.', group: 'Motion', random: { min: 0.35, max: 1.4 } },
    { name: 'contrast', type: 'float', default: 1, min: 0.25, max: 2, step: 0.01, label: 'Contrast', description: 'Contrast applied to the imported composition.', group: 'Shape', random: { min: 0.7, max: 1.35 } },
    { name: 'brightness', type: 'float', default: 1, min: 0, max: 2, step: 0.01, label: 'Brightness', description: 'Overall light intensity.', group: 'Color', random: { min: 0.65, max: 1.25 } },
    { name: 'saturation', type: 'float', default: 1, min: 0, max: 2, step: 0.01, label: 'Saturation', description: 'Color intensity; zero is grayscale.', group: 'Color', random: { min: 0.55, max: 1.35 } },
    {"name":"palette","type":"select","default":"original","options":["original","custom"],"label":"Color treatment","description":"Original preserves upstream colors. Custom maps dark, middle and bright tones to editable colors.","group":"Color","random":false},
    {"name":"shadowColor","type":"color","default":"#050b16","label":"Shadow tone","description":"Shadow tone in the custom tonal palette; preserves the source shading.","group":"Color","colorRole":"surface","visibleWhen":{"name":"palette","value":"custom"}},
    {"name":"midtoneColor","type":"color","default":"#347d9a","label":"Midtone","description":"Midtone in the custom tonal palette; preserves the source shading.","group":"Color","colorRole":"primary","visibleWhen":{"name":"palette","value":"custom"}},
    {"name":"highlightColor","type":"color","default":"#e3f7ff","label":"Highlight tone","description":"Highlight tone in the custom tonal palette; preserves the source shading.","group":"Color","colorRole":"secondary","visibleWhen":{"name":"palette","value":"custom"}},
  ],
});
