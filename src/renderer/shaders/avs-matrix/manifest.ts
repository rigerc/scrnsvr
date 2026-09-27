import { manifest } from '../../../shared/manifest';

export const avsMatrixManifest = manifest({
  id: "avs-matrix",
  title: "Digital Rain",
  category: "Digital",
  description: "Imported from AVS; original shader notices are preserved in the source.",
  fragment: 'shader.glsl',
  schemePalette: 'custom',
  uniforms: [
    { name: 'speed', type: 'float', default: 1, min: 0, max: 3, step: 0.01, label: 'Speed', description: 'Overall animation speed; zero freezes movement.', group: 'Motion', random: { min: 0.35, max: 1.4 } },
    { name: 'contrast', type: 'float', default: 1, min: 0.25, max: 2, step: 0.01, label: 'Contrast', description: 'Contrast applied to the imported composition.', group: 'Shape', random: { min: 0.7, max: 1.35 } },
    { name: 'brightness', type: 'float', default: 1, min: 0, max: 2, step: 0.01, label: 'Brightness', description: 'Overall light intensity.', group: 'Color', random: { min: 0.65, max: 1.25 } },
    { name: 'saturation', type: 'float', default: 1, min: 0, max: 2, step: 0.01, label: 'Saturation', description: 'Color intensity; zero is grayscale.', group: 'Color', random: { min: 0.55, max: 1.35 } },
    {"name":"glyphFill","type":"float","default":0.9,"min":0.35,"max":1,"step":0.01,"label":"Glyph density","description":"Fraction of glyph slots filled in each falling strip.","group":"Shape","random":{"min":0.675,"max":1}},
    {"name":"glyphStroke","type":"float","default":1,"min":0.6,"max":1.5,"step":0.01,"label":"Glyph stroke","description":"Width of the luminous strokes within each glyph.","group":"Shape","random":{"min":0.75,"max":1.25}},
    {"name":"glyphGlow","type":"float","default":1,"min":0.25,"max":1.5,"step":0.01,"label":"Glyph glow","description":"Width of the soft light surrounding the glyphs.","group":"Shape","random":{"min":0.75,"max":1.25}},
    {"name":"rainSpeed","type":"float","default":1,"min":0,"max":2,"step":0.01,"label":"Rain drift","description":"Falling and changing glyph speed relative to camera travel.","group":"Motion","random":{"min":0.75,"max":1.25}},
    {"name":"palette","type":"select","default":"original","options":["original","custom"],"label":"Color treatment","description":"Original preserves upstream colors. Custom maps dark, middle and bright tones to editable colors.","group":"Color","random":false},
    {"name":"shadowColor","type":"color","default":"#050b16","label":"Background","description":"Background in the custom tonal palette; preserves the source shading.","group":"Color","colorRole":"surface","visibleWhen":{"name":"palette","value":"custom"}},
    {"name":"midtoneColor","type":"color","default":"#35cf80","label":"Emission","description":"Emission in the custom tonal palette; preserves the source shading.","group":"Color","colorRole":"primary","visibleWhen":{"name":"palette","value":"custom"}},
    {"name":"highlightColor","type":"color","default":"#e3f7ff","label":"Glow highlight","description":"Glow highlight in the custom tonal palette; preserves the source shading.","group":"Color","colorRole":"secondary","visibleWhen":{"name":"palette","value":"custom"}},
  ],
});
