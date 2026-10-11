import type { EffectDefinition } from '../../shared/effects';
import { effectManifests } from '../../shared/effect-catalog';
import crtMonitor from './crt-monitor.glsl';
import analogFilm from './analog-film.glsl';
import pixelate from './pixelate.glsl';
import orderedDither from './ordered-dither.glsl';
import chromaticAberration from './chromatic-aberration.glsl';
import kaleidoscope from './kaleidoscope.glsl';
import dreamBlur from './dream-blur.glsl';
import digitalGlitch from './digital-glitch.glsl';
import lensDistortion from './lens-distortion.glsl';
import colorGrade from './color-grade.glsl';
import vignette from './vignette.glsl';
import liquidGlass from './liquid-glass.glsl';
import halftonePrint from './halftone-print.glsl';
import paletteMapping from './palette-mapping.glsl';

/** Original single-pass shaders, with the shared catalog as their metadata source. */
export const additionalEffectRegistry: Record<string, EffectDefinition> = Object.fromEntries(
  Object.entries({
    'crt-monitor': crtMonitor,
    'analog-film': analogFilm,
    pixelate,
    'ordered-dither': orderedDither,
    'chromatic-aberration': chromaticAberration,
    kaleidoscope,
    'dream-blur': dreamBlur,
    'digital-glitch': digitalGlitch,
    'lens-distortion': lensDistortion,
    'color-grade': colorGrade,
    vignette,
    'liquid-glass': liquidGlass,
    'halftone-print': halftonePrint,
    'palette-mapping': paletteMapping,
  }).map(([id, source]) => [id, { ...effectManifests[id], source }]),
);
