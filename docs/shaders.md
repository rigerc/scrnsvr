# Shaders

scrnsvr draws every background with a single-pass GLSL fragment shader. The **53 built-in shaders** live in [`src/renderer/shaders/`](../src/renderer/shaders/), one folder each:

```
src/renderer/shaders/<id>/
  manifest.ts   # title, category, description and controls
  shader.glsl   # the fragment shader itself
```

Choose one in Settings, save adjustments as a look, add several to the shuffle rotation, or open one directly in a window:

```bash
npm start -- --preview --shader aurora-veil
```

GLSL you add yourself appears under **Custom** and is documented separately in [Custom and reactive shaders](custom-and-reactive-shaders.md).

## Reading an entry

Each entry below shows the shader's ID (the value used in `--shader`, in rotation lists and in the `shaders` config object), how many controls it has, how many of those are colors, and — for imported effects — the upstream project it was ported from. Ranges, steps and defaults are in each `manifest.ts`; [Shader parameters](shader-parameters.md) describes what a shader's extra controls do.

Every shader, imported or native, exposes the same three anchors: **Speed** (zero freezes the animation), **Brightness**, and **Saturation** (zero is grayscale). The rest of its controls are grouped into **Motion**, **Shape** and **Color**, with rarer adjustments behind **Advanced**. Randomize respects each control's range and step, conservative motion bounds and the shader's background colors.

Colors come from the global color scheme. A scheme supplies a background, text and three accent roles that map onto the shader's color controls, and any shader can keep its own colors instead. The 28 imported effects offer a **Color treatment** choice between *Original* (their upstream palette) and *Custom* (editable tones); Flow Field switches between Aurora, Mono and Duotone, and Chromatic Plasma between Neon, Sunset, Ice and Custom.

## Contents

| Category | Shaders | Character |
|---|---|---|
| [Abstract](#abstract) | 15 | Patterns, linework and simulated materials |
| [Ambient](#ambient) | 10 | Slow drifts, gradients and soft light |
| [Clocks](#clocks) | 3 | Effects that draw the time themselves |
| [Digital](#digital) | 5 | Grids, code and neon geometry |
| [Landscapes](#landscapes) | 6 | Horizons, terrain and weather |
| [Reactive](#reactive) | 3 | Ambient scenes that follow playing audio |
| [Space](#space) | 5 | Starfields, nebulae and deep sky |
| [Water](#water) | 6 | Seas, ripples and refracted light |

## Abstract

### Chromatic Plasma
`plasma` · 13 controls · 3 colors

Rainbow plasma swells and folds through soft-edged color.

### Chromatic Ripple
`avs-ripple` · 8 controls · 3 colors · ported from AVS

Blue cellular ripples drift like light scattered through shallow water.

### Fractal Fold
`avs-fractal` · 8 controls · 3 colors · ported from AVS

Electric filaments branch and reconnect across black.

### Ghosts
`shadersaver-ghosts` · 8 controls · 3 colors · ported from ShaderSaver

Violet and cyan smoke curls through the dark like drifting spirits.

### Guilloché
`guilloche` · 11 controls · 3 colors

Fine interwoven curves slowly evolve like intricate ornamental engravings.

### Liquid Chrome
`liquid-chrome` · 13 controls · 4 colors

Broad studio lights ripple across a slowly undulating metallic surface.

### Magnetic Filaments
`magnetic-filaments` · 10 controls · 3 colors

Fine luminous field lines bend around slowly orbiting magnetic poles.

### Opal Film
`opal-film` · 12 controls · 4 colors

Pearlescent bands glide over a gently flexing, luminous surface.

### Orbital Interference
`interference` · 13 controls · 2 colors

Concentric rings from orbiting sources overlap into shifting interference patterns.

### Origami
`shadersaver-origami` · 8 controls · 3 colors · ported from ShaderSaver

Folded paper squares unfold in rainbow layers against cream.

### Prism Mosaic
`prism-mosaic` · 10 controls · 3 colors

Drifting glass facets catch colored light along their beveled edges.

### Simplex
`shadersaver-simplex` · 8 controls · 3 colors · ported from ShaderSaver

Neon wireframe crystals tumble through a shimmering lattice.

### Sinus
`avs-sinus` · 8 controls · 3 colors · ported from AVS

A glowing green sine wave snakes across the dark.

### Waveform
`shadersaver-waveform` · 8 controls · 3 colors · ported from ShaderSaver

A luminous waveform surges in white and acid green.

### Waves
`avs-waves` · 8 controls · 3 colors · ported from AVS

Green light filaments braid into a knot and fan apart again.

## Ambient

### Aurora Veil
`aurora-veil` · 13 controls · 4 colors

Translucent ribbons of light ripple across a midnight gradient.

### Ember Drift
`ember-drift` · 16 controls · 3 colors

Warm motes rise and softly fade against a smoky night.

### Flow Field
`flow-field` · 14 controls · 3 colors

Slow currents of luminous color.

### Gradient Blobs
`gradient-blobs` · 16 controls · 4 colors

Glowing gradient blobs float, merge, and gently pull apart.

### Gradient Drift
`gradient-drift` · 13 controls · 3 colors

Wide, silky bands of color that slowly turn and drift.

### Ink Bloom
`ink-bloom` · 14 controls · 3 colors

Feathery clouds of pigment unfurl through softly lit paper.

### Mesh Gradient
`mesh-gradient` · 17 controls · 4 colors

Four floating pools of color blend into a soft, shifting mesh.

### Paper Lanterns
`paper-lanterns` · 12 controls · 3 colors

Warm translucent lanterns float upward through a deep, quiet night.

### Phosphor Garden
`phosphor-garden` · 10 controls · 3 colors

Luminous stems unfurl as gentle pulses travel toward their growing tips.

### Silk Ribbons
`silk-ribbons` · 13 controls · 3 colors

Pearlescent bands of rose and blue silk unfurl in the dark.

## Clocks

These shaders render the time as part of the effect. The separate clock overlay in Settings is independent of them and can layer on top of any shader.

### Glow Clock
`avs-glow-clock` · 13 controls · 3 colors · ported from AVS

Ember-orange digits glow against black.

### Green Clock
`avs-green-clock` · 13 controls · 3 colors · ported from AVS

Tall green digits stack the time on black.

### Seven-Segment Clock
`avs-seven-segment` · 12 controls · 3 colors · ported from AVS

Large seven-segment digits show the time in green.

## Digital

### Digital Rain
`avs-matrix` · 12 controls · 3 colors · ported from AVS

Green code rain streams down a dark terminal.

### Kinetic Tiles
`kinetic-tiles` · 11 controls · 3 colors

Rounded tiles turn and slide in coordinated waves across a quiet grid.

### Rainbow Road
`shadersaver-rainbow-road` · 8 controls · 3 colors · ported from ShaderSaver

Neon rainbow bars race into the distance like a glowing highway.

### Shield
`shadersaver-shield` · 8 controls · 3 colors · ported from ShaderSaver

A blue hexagonal shield pulses with radial light spikes.

### Tunnel Wisp
`avs-tunnel-wisp` · 8 controls · 3 colors · ported from AVS

Rounded tunnel frames tumble past in amber and blue light.

## Landscapes

### Alien Waterworld
`avs-alien-waterworld` · 8 controls · 3 colors · ported from AVS

A deep blue water world turns past, veiled in bright cloud.

### Cloudscape
`avs-clouds` · 11 controls · 3 colors · ported from AVS

Cumulus clouds drift across a bright blue sky.

### Contour Dunes
`contour-dunes` · 13 controls · 2 colors

Copper and indigo contour lines flow like wind-shaped dunes.

### Mountain Terrain
`avs-terrain` · 10 controls · 3 colors · ported from AVS

Arid ridges rise above rippled desert sand.

### Sunlit Field
`avs-field` · 10 controls · 3 colors · ported from AVS

A green field rolls to low hills under a pale sky.

### Sunset
`shadersaver-sunset` · 8 controls · 3 colors · ported from ShaderSaver

An iridescent horizon burns turquoise and amber.

## Reactive

These shaders add a response to playing audio on top of their ambient animation. Enable **React to playing audio** in Settings, then set each shader's **Audio influence**. The capture reads the default output monitor, never the microphone; with audio disabled or silent, the scenes run as ordinary ambient effects. See [Custom and reactive shaders](custom-and-reactive-shaders.md) for the capture details.

Their IDs are kept from the earlier Pulse Rings, Audio Ribbons and Bass Bloom shaders, so existing selections, rotation entries and presets continue to work.

### Lightwell
`reactive-pulse-rings` · 11 controls · 3 colors

Defocused ivory and amber light drifts over charcoal, gently warmed by sustained sound.

### Quiet Horizon
`reactive-audio-ribbons` · 11 controls · 3 colors

Lavender haze and a pale peach horizon breathe slowly through a deep navy landscape.

### Velvet Cloud
`reactive-bass-bloom` · 11 controls · 3 colors

A softly lit volume of smoky plum and copper folds through darkness, stirred by sustained sound.

## Space

### Galaxy
`avs-galaxy` · 8 controls · 3 colors · ported from AVS

A dense amber starfield drifts through faint nebula dust.

### Singularity
`shadersaver-singularity` · 8 controls · 3 colors · ported from ShaderSaver

A dark singularity bends an orbiting stream of fire and ice.

### Star Drift
`star-drift` · 14 controls · 3 colors

Layers of softly glowing stars glide through a deep night sky.

### Star Dust
`avs-stardust` · 8 controls · 3 colors · ported from AVS

Silver dust streaks past in a looping flight through the dark.

### Starship
`shadersaver-starship` · 8 controls · 3 colors · ported from ShaderSaver

Amber light streaks rush past as the view jumps to lightspeed.

## Water

### Emerald Ocean
`avs-ocean` · 10 controls · 3 colors · ported from AVS

Glowing green ridges swell and sweep like a luminous ocean.

### Rain Glass
`rain-glass` · 10 controls · 3 colors

Slow droplets trail down glass over blurred pools of nighttime color.

### Sea
`avs-sea` · 11 controls · 3 colors · ported from AVS

Open blue sea rolls in waves toward a bright horizon.

### Seascape
`avs-seascape` · 10 controls · 3 colors · ported from AVS

Rugged mountains stand over a dim shoreline.

### Tidal Caustics
`tidal-caustics` · 12 controls · 2 colors

Soft pools of refracted light wander across a tranquil seabed.

### Water Ripples
`shadersaver-water-ripples` · 11 controls · 3 colors · ported from ShaderSaver

A droplet falls toward concentric ripples in still gray-blue water.

## Imported shaders

28 of the built-in shaders are browser-compatible ports: 18 from [AVS](https://github.com/PsyChip/AVS) and 10 from [ShaderSaver](https://github.com/fearlessfrog/ShaderSaver). The ports rewrite the sources for WebGL, add scrnsvr's color treatment and standard controls, and keep the original notices in each `shader.glsl`. Pinned revisions, per-effect credits, license notes and the exclusions are recorded in [THIRD_PARTY_SHADERS.md](../THIRD_PARTY_SHADERS.md).

## Related documentation

- [Shader parameters](shader-parameters.md) — what the controls do, per shader
- [Custom and reactive shaders](custom-and-reactive-shaders.md) — your own GLSL, and audio capture
- [Authoring shaders](authoring-shaders.md) — add or modify a built-in shader
- [Configuration](../README.md#config) — `shader`, `shaders`, `presets` and color schemes in the config file
