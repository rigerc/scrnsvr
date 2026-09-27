import { manifest } from '../../../shared/manifest';

export const shadersaverWaterRipplesManifest = manifest({
  id: "shadersaver-water-ripples",
  title: "Water Ripples",
  category: "Water",
  description: "Imported from ShaderSaver; original shader notices are preserved in the source.",
  fragment: 'shader.glsl',
  schemePalette: 'custom',
  uniforms: [
    { name: 'speed', type: 'float', default: 1, min: 0, max: 3, step: 0.01, label: 'Speed', description: 'Overall animation speed; zero freezes movement.', group: 'Motion', random: { min: 0.35, max: 1.4 } },
    { name: 'contrast', type: 'float', default: 1, min: 0.25, max: 2, step: 0.01, label: 'Contrast', description: 'Contrast applied to the imported composition.', group: 'Shape', random: { min: 0.7, max: 1.35 } },
    { name: 'brightness', type: 'float', default: 1, min: 0, max: 2, step: 0.01, label: 'Brightness', description: 'Overall light intensity.', group: 'Color', random: { min: 0.65, max: 1.25 } },
    { name: 'saturation', type: 'float', default: 1, min: 0, max: 2, step: 0.01, label: 'Saturation', description: 'Color intensity; zero is grayscale.', group: 'Color', random: { min: 0.55, max: 1.35 } },
    {"name":"waveHeight","type":"float","default":1,"min":0.25,"max":1.4,"step":0.01,"label":"Ripple height","description":"Height of the concentric surface ripples.","group":"Shape","random":{"min":0.75,"max":1.25}},
    {"name":"waveDensity","type":"float","default":1,"min":0.6,"max":1.5,"step":0.01,"label":"Ripple density","description":"Number of ripple crests across the water surface.","group":"Shape","random":{"min":0.75,"max":1.25}},
    {"name":"dropSize","type":"float","default":1,"min":0.5,"max":1.3,"step":0.01,"label":"Drop size","description":"Size of the two bouncing water drops.","group":"Shape","random":{"min":0.75,"max":1.25}},
    {"name":"palette","type":"select","default":"original","options":["original","custom"],"label":"Color treatment","description":"Original preserves upstream colors. Custom maps dark, middle and bright tones to editable colors.","group":"Color","random":false},
    {"name":"shadowColor","type":"color","default":"#050b16","label":"Deep-water tone","description":"Deep-water tone in the custom tonal palette; preserves the source shading.","group":"Color","colorRole":"surface","visibleWhen":{"name":"palette","value":"custom"}},
    {"name":"midtoneColor","type":"color","default":"#347d9a","label":"Water tone","description":"Water tone in the custom tonal palette; preserves the source shading.","group":"Color","colorRole":"primary","visibleWhen":{"name":"palette","value":"custom"}},
    {"name":"highlightColor","type":"color","default":"#e3f7ff","label":"Reflection tone","description":"Reflection tone in the custom tonal palette; preserves the source shading.","group":"Color","colorRole":"secondary","visibleWhen":{"name":"palette","value":"custom"}},
  ],
});
