// Effect controls are applied after compatibility repairs, before wrapping.
// Keep upstream literals at default values: existing saved looks use Original.
const number = (name, label, value, min, max, description, extra = {}) => ({ name, type: 'float', default: value, min, max, step: 0.01, label, description, group: 'Shape', random: { min: Math.max(min, value * 0.75), max: Math.min(max, value * 1.25) }, ...extra });
const toggle = (name, label, value, description) => ({ name, type: 'bool', default: value, label, description, group: 'Shape', random: false });
const clockIds = ['avs-seven-segment', 'avs-glow-clock', 'avs-green-clock'];

export function effectControls(item) {
  if (clockIds.includes(item.id)) return [
    number('clockSize', 'Digit size', 1, 0.65, 1.5, 'Size of the clock around the center of the screen.'),
    toggle('twelveHour', '12-hour format', item.id === 'avs-glow-clock', 'Display hours from 1 to 12 instead of 0 to 23.'),
    toggle('showSeconds', 'Show seconds', true, 'Show the seconds digits and their separator.'),
    ...(item.id === 'avs-seven-segment' ? [toggle('digitMatrix', 'LED texture', true, 'Break the segments into a fine LED matrix.')] : [
      number('glowWidth', 'Glow reach', 1, 0.4, 1.8, 'Reach and intensity of light around the digit strokes.'),
      number('glowPulse', 'Glow flicker', 1, 0, 1.5, 'Amount of animated variation in the digit glow.', { group: 'Motion' }),
    ]),
  ];
  if (item.id === 'avs-matrix') return [
    number('glyphFill', 'Glyph density', 0.9, 0.35, 1, 'Fraction of glyph slots filled in each falling strip.'),
    number('glyphStroke', 'Glyph stroke', 1, 0.6, 1.5, 'Width of the luminous strokes within each glyph.'),
    number('glyphGlow', 'Glyph glow', 1, 0.25, 1.5, 'Width of the soft light surrounding the glyphs.'),
    number('rainSpeed', 'Rain drift', 1, 0, 2, 'Falling and changing glyph speed relative to camera travel.', { group: 'Motion' }),
  ];
  if (item.id === 'shadersaver-water-ripples') return [
    number('waveHeight', 'Ripple height', 1, 0.25, 1.4, 'Height of the concentric surface ripples.'),
    number('waveDensity', 'Ripple density', 1, 0.6, 1.5, 'Number of ripple crests across the water surface.'),
    number('dropSize', 'Drop size', 1, 0.5, 1.3, 'Size of the two bouncing water drops.'),
  ];
  if (item.id === 'avs-ocean' || item.id === 'avs-sea') return [
    number('waveHeight', 'Wave height', 1, 0.4, 1.5, 'Vertical amplitude of the ocean surface.'),
    number('waveDensity', 'Wave density', 1, 0.6, 1.5, 'Spatial frequency of waves; higher values pack crests closer together.'),
    ...(item.id === 'avs-sea' ? [number('waveChop', 'Crest sharpness', 1, 0.5, 1.5, 'Sharpness of the wave crests.')] : []),
  ];
  if (item.id === 'avs-clouds') return [
    number('cloudDensity', 'Cloud density', 1, 0.5, 1.8, 'Spatial density of cloud formations; higher values make smaller clouds.'),
    number('cloudCoverage', 'Cloud coverage', 0.2, -0.2, 0.65, 'Amount of the sky filled by cloud.', { random: { min: 0, max: 0.4 } }),
    number('cloudSoftness', 'Cloud opacity', 1, 0.4, 1.5, 'Strength of the cloud layer against the sky.'),
  ];
  if (item.id === 'avs-terrain') return [
    number('terrainHeight', 'Mountain height', 1, 0.6, 1.25, 'Height of mountain ridges above the ground.'),
    number('terrainDensity', 'Ridge density', 1, 0.7, 1.4, 'Spatial frequency of mountain ridges.'),
  ];
  if (item.id === 'avs-seascape') return [
    number('waveHeight', 'Surface height', 1, 0.6, 1.3, 'Height of the undulating surface.'),
    number('waveDensity', 'Surface density', 1, 0.7, 1.3, 'Spacing of the undulating surface features.'),
  ];
  if (item.id === 'avs-field') return [
    number('grassSway', 'Grass sway', 1, 0, 1.5, 'Amount of wind-driven movement of the grass.', { group: 'Motion' }),
    number('fogDensity', 'Distance haze', 1, 0.4, 1.8, 'Strength of the haze blending distant grass into the sky.'),
  ];
  return [];
}

export function importedControls(item) {
  const luminous = clockIds.includes(item.id) || item.id === 'avs-matrix';
  const water = item.category === 'Water';
  return [
    ...effectControls(item),
    { name: 'palette', type: 'select', default: 'original', options: ['original', 'custom'], label: 'Color treatment', description: 'Original preserves upstream colors. Custom maps dark, middle and bright tones to editable colors.', group: 'Color', random: false },
    ...[
      ['shadowColor', luminous ? 'Background' : water ? 'Deep-water tone' : 'Shadow tone', '#050b16', 'surface'],
      ['midtoneColor', luminous ? 'Emission' : water ? 'Water tone' : 'Midtone', luminous ? '#35cf80' : '#347d9a', 'primary'],
      ['highlightColor', luminous ? 'Glow highlight' : water ? 'Reflection tone' : 'Highlight tone', '#e3f7ff', 'secondary'],
    ].map(([name, label, value, colorRole]) => ({ name, type: 'color', default: value, label, description: `${label} in the custom tonal palette; preserves the source shading.`, group: 'Color', colorRole, visibleWhen: { name: 'palette', value: 'custom' } })),
  ];
}

export function controlDeclarations(item) {
  return importedControls(item).map(def => `uniform ${def.type === 'color' ? 'vec3' : def.type === 'select' ? 'int' : def.type} ${def.name};`).join('\n') + '\n';
}

// Apply to the repaired upstream body only, never to an already wrapped module.
export function applyEffectControls(body, item) {
  if (clockIds.includes(item.id)) {
    body = body.replace(/\* 2\.([58]);/, '* 2.$1 / clockSize;')
      .replace('uv *= 15.0;', 'uv *= 15.0 / clockSize;')
      .replace('bool ampm = false;', 'bool ampm = twelveHour;')
      .replace('bool showMatrix = true;', '#define showMatrix digitMatrix')
      .replace(/#if TWELVE_HOUR_CLOCK\s*([\s\S]*?)#endif/, 'if (twelveHour) {\n$1}')
      .replace(/#if SECONDS\s*([\s\S]*?)#endif/, 'if (showSeconds) {\n$1}')
      .replace('seg += showNum(uv, sec, false);', 'if (showSeconds) seg += showNum(uv, sec, false);')
      .replace('seg += dots(uv);', 'if (showSeconds) seg += dots(uv);')
      .replace('dist = min(dist, dfNumberInt(pos, sec, uv));', 'if (showSeconds) dist = min(dist, dfNumberInt(pos, sec, uv));')
      .replace(/(\/\/ MM[\s\S]*?pos\.x \+= 0\.23;\s*)dist = min\(dist, dfColon\(pos, uv\)\);/, '$1if (showSeconds) dist = min(dist, dfColon(pos, uv));')
      .replace(/(0\.00[46]) \/ \(dist\)/, '$1 * glowWidth / (dist)')
      .replace(/(shade \* noise\([^\n]+\));/, '$1 * glowPulse;');
  }
  if (item.id === 'avs-matrix') body = body
    .replace('smoothstep(0.1, 0., d)', 'smoothstep(0.1 * glyphStroke, 0., d)')
    .replace('smoothstep(0.4, 0., d)', 'smoothstep(0.4 * glyphGlow, 0., d)')
    .replace('char_hash.x >= 0.1', 'char_hash.x >= 1.0 - glyphFill')
    .replace('rain(ro, rd, time)', 'rain(ro, rd, time * rainSpeed)');
  if (item.id === 'shadersaver-water-ripples') body = body
    .replace('.4*sin(l*3.-iTime+.5)', '(.4 * waveHeight)*sin(l*(3. * waveDensity)-iTime+.5)')
    .replace(')*h1)-.4;', ')*h1)-.4 * dropSize;')
    .replace(')*h2)-.2)', ')*h2)-.2 * dropSize)');
  if (item.id === 'avs-ocean') body = body
    .replace('float f = waveFreq;', 'float f = waveFreq * waveDensity;')
    .replace('p += waveAmp * sin', 'p += waveAmp * waveHeight * sin');
  if (item.id === 'avs-sea') body = body
    .replaceAll('float freq = SEA_FREQ;', 'float freq = SEA_FREQ * waveDensity;')
    .replaceAll('float amp = SEA_HEIGHT;', 'float amp = SEA_HEIGHT * waveHeight;')
    .replaceAll('float choppy = SEA_CHOPPY;', 'float choppy = SEA_CHOPPY * waveChop;')
    .replace('(p.y - SEA_HEIGHT)', '(p.y - SEA_HEIGHT * waveHeight)');
  if (item.id === 'avs-clouds') body = body
    .replace('const float cloudscale = 1.1;', '#define cloudscale (1.1 * cloudDensity)')
    .replace('const float cloudcover = 0.2;', '#define cloudcover cloudCoverage')
    .replace('const float cloudalpha = 8.0;', '#define cloudalpha (8.0 * cloudSoftness)');
  if (item.id === 'avs-terrain') body = body
    .replaceAll('p *= 0.0013;', 'p *= 0.0013 * terrainDensity;')
    .replaceAll('return t * 55.0;', 'return t * 55.0 * terrainHeight;')
    .replace('float maxh = 130.0;', 'float maxh = 130.0 * terrainHeight;');
  if (item.id === 'avs-seascape') body = body
    .replaceAll('vec2 q = pos.xz*0.5;', 'vec2 q = pos.xz*(0.5 * waveDensity);')
    .replaceAll('h *= 3.0;', 'h *= 3.0 * waveHeight;');
  if (item.id === 'avs-field') body = body
    .replace('dis*dis* 0.0000012', 'dis*dis* 0.0000012 * fogDensity')
    .replace('sin(time*3.6+1.5*p.x))*y*.5', 'sin(time*3.6+1.5*p.x))*y*.5 * grassSway');
  return body;
}

export const paletteApplication = `  if (palette == 1) {
    // Soft-compress the source range so dark, middle and bright tones all
    // contribute: a bright cloudscape must still respond to the shadow tone.
    float raw = max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b));
    float tone = max(raw, 0.0) / (1.0 + max(raw, 0.0));
    vec3 mapped = mix(shadowColor, midtoneColor, tone);
    mapped = mix(mapped, highlightColor, tone * tone);
    gl_FragColor.rgb = mapped + highlightColor * max(raw - 1.0, 0.0);
  }\n`;
