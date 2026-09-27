import { manifest } from '../../../shared/manifest';

export const avsGlowClockManifest = manifest({
  id: "avs-glow-clock",
  title: "Glow Clock",
  category: "Clocks",
  description: "Imported from AVS; original shader notices are preserved in the source.",
  fragment: 'shader.glsl',
  schemePalette: 'custom',
  uniforms: [
    { name: 'speed', type: 'float', default: 1, min: 0, max: 3, step: 0.01, label: 'Speed', description: 'Overall animation speed; zero freezes movement.', group: 'Motion', random: { min: 0.35, max: 1.4 } },
    { name: 'contrast', type: 'float', default: 1, min: 0.25, max: 2, step: 0.01, label: 'Contrast', description: 'Contrast applied to the imported composition.', group: 'Shape', random: { min: 0.7, max: 1.35 } },
    { name: 'brightness', type: 'float', default: 1, min: 0, max: 2, step: 0.01, label: 'Brightness', description: 'Overall light intensity.', group: 'Color', random: { min: 0.65, max: 1.25 } },
    { name: 'saturation', type: 'float', default: 1, min: 0, max: 2, step: 0.01, label: 'Saturation', description: 'Color intensity; zero is grayscale.', group: 'Color', random: { min: 0.55, max: 1.35 } },
    {"name":"clockSize","type":"float","default":1,"min":0.65,"max":1.5,"step":0.01,"label":"Digit size","description":"Size of the clock around the center of the screen.","group":"Shape","random":{"min":0.75,"max":1.25}},
    {"name":"twelveHour","type":"bool","default":true,"label":"12-hour format","description":"Display hours from 1 to 12 instead of 0 to 23.","group":"Shape","random":false},
    {"name":"showSeconds","type":"bool","default":true,"label":"Show seconds","description":"Show the seconds digits and their separator.","group":"Shape","random":false},
    {"name":"glowWidth","type":"float","default":1,"min":0.4,"max":1.8,"step":0.01,"label":"Glow reach","description":"Reach and intensity of light around the digit strokes.","group":"Shape","random":{"min":0.75,"max":1.25}},
    {"name":"glowPulse","type":"float","default":1,"min":0,"max":1.5,"step":0.01,"label":"Glow flicker","description":"Amount of animated variation in the digit glow.","group":"Motion","random":{"min":0.75,"max":1.25}},
    {"name":"palette","type":"select","default":"original","options":["original","custom"],"label":"Color treatment","description":"Original preserves upstream colors. Custom maps dark, middle and bright tones to editable colors.","group":"Color","random":false},
    {"name":"shadowColor","type":"color","default":"#050b16","label":"Background","description":"Background in the custom tonal palette; preserves the source shading.","group":"Color","colorRole":"surface","visibleWhen":{"name":"palette","value":"custom"}},
    {"name":"midtoneColor","type":"color","default":"#35cf80","label":"Emission","description":"Emission in the custom tonal palette; preserves the source shading.","group":"Color","colorRole":"primary","visibleWhen":{"name":"palette","value":"custom"}},
    {"name":"highlightColor","type":"color","default":"#e3f7ff","label":"Glow highlight","description":"Glow highlight in the custom tonal palette; preserves the source shading.","group":"Color","colorRole":"secondary","visibleWhen":{"name":"palette","value":"custom"}},
  ],
});
