import { manifest } from '../../../shared/manifest';

export const avsCloudsManifest = manifest({
  id: "avs-clouds",
  title: "Cloudscape",
  category: "Landscapes",
  description: "Imported from AVS; original shader notices are preserved in the source.",
  fragment: 'shader.glsl',
  schemePalette: 'custom',
  uniforms: [
    { name: 'speed', type: 'float', default: 1, min: 0, max: 3, step: 0.01, label: 'Speed', description: 'Overall animation speed; zero freezes movement.', group: 'Motion', random: { min: 0.35, max: 1.4 } },
    { name: 'contrast', type: 'float', default: 1, min: 0.25, max: 2, step: 0.01, label: 'Contrast', description: 'Contrast applied to the imported composition.', group: 'Shape', random: { min: 0.7, max: 1.35 } },
    { name: 'brightness', type: 'float', default: 1, min: 0, max: 2, step: 0.01, label: 'Brightness', description: 'Overall light intensity.', group: 'Color', random: { min: 0.65, max: 1.25 } },
    { name: 'saturation', type: 'float', default: 1, min: 0, max: 2, step: 0.01, label: 'Saturation', description: 'Color intensity; zero is grayscale.', group: 'Color', random: { min: 0.55, max: 1.35 } },
    {"name":"cloudDensity","type":"float","default":1,"min":0.5,"max":1.8,"step":0.01,"label":"Cloud density","description":"Spatial density of cloud formations; higher values make smaller clouds.","group":"Shape","random":{"min":0.75,"max":1.25}},
    {"name":"cloudCoverage","type":"float","default":0.2,"min":-0.2,"max":0.65,"step":0.01,"label":"Cloud coverage","description":"Amount of the sky filled by cloud.","group":"Shape","random":{"min":0,"max":0.4}},
    {"name":"cloudSoftness","type":"float","default":1,"min":0.4,"max":1.5,"step":0.01,"label":"Cloud opacity","description":"Strength of the cloud layer against the sky.","group":"Shape","random":{"min":0.75,"max":1.25}},
    {"name":"palette","type":"select","default":"original","options":["original","custom"],"label":"Color treatment","description":"Original preserves upstream colors. Custom maps dark, middle and bright tones to editable colors.","group":"Color","random":false},
    {"name":"shadowColor","type":"color","default":"#050b16","label":"Shadow tone","description":"Shadow tone in the custom tonal palette; preserves the source shading.","group":"Color","colorRole":"surface","visibleWhen":{"name":"palette","value":"custom"}},
    {"name":"midtoneColor","type":"color","default":"#347d9a","label":"Midtone","description":"Midtone in the custom tonal palette; preserves the source shading.","group":"Color","colorRole":"primary","visibleWhen":{"name":"palette","value":"custom"}},
    {"name":"highlightColor","type":"color","default":"#e3f7ff","label":"Highlight tone","description":"Highlight tone in the custom tonal palette; preserves the source shading.","group":"Color","colorRole":"secondary","visibleWhen":{"name":"palette","value":"custom"}},
  ],
});
