import type { UniformManifest } from './manifest';
import type { EffectManifest } from './effects';

const number = (name: string, label: string, value: number, min: number, max: number, description: string, step = 0.01): UniformManifest => ({
  name, label, type: 'float', default: value, min, max, step, description,
});
const unit = (name: string, label: string, value: number, description: string) => number(name, label, value, 0, 1, description);
const integer = (name: string, label: string, value: number, min: number, max: number, description: string): UniformManifest => ({
  ...number(name, label, value, min, max, description, 1), type: 'int',
});
const intensity = (value = 0.5) => unit('intensity', 'Intensity', value, 'Blend with the original image. Zero bypasses this layer.');
const centers = () => [unit('centerX', 'Center X', 0.5, 'Horizontal optical center.'), unit('centerY', 'Center Y', 0.5, 'Vertical optical center.')];
const manifest = (id: string, title: string, description: string, uniforms: UniformManifest[]): EffectManifest => ({ id, title, description, uniforms });

/** Metadata is shared by config recovery, inspector controls, and the GPU registry. */
export const effectManifests: Record<string, EffectManifest> = Object.fromEntries([
  manifest('vhs-distortion', 'VHS Distortion', 'Analog tape texture, color bleed, and drifting tracking interference.', [
    intensity(), unit('grain', 'Grain', 0.2, 'Animated fine-grained tape noise.'),
    unit('scanlines', 'Scanlines', 0.25, 'Subtle horizontal scanline shading.'),
    unit('colorBleed', 'Color bleed', 0.2, 'Separate color channels horizontally.'),
    unit('tracking', 'Tracking distortion', 0.15, 'Horizontal jitter and a drifting interference band.'),
  ]),
  manifest('crt-monitor', 'CRT Monitor', 'Curved glass, a phosphor mask, and softly shaded screen edges.', [
    intensity(), unit('curvature', 'Curvature', 0.12, 'Bow the image like a curved television tube.'),
    unit('maskStrength', 'Phosphor mask', 0.15, 'Fine red, green, and blue phosphor stripes.'),
    unit('scanlines', 'Scanlines', 0.15, 'Horizontal scanline shading.'),
    unit('edgeFalloff', 'Edge falloff', 0.2, 'Darken the rounded screen boundary.'),
  ]),
  manifest('analog-film', 'Analog Film', 'Fine film grain, warm color, faded blacks, and slow exposure drift.', [
    intensity(), unit('grain', 'Grain', 0.15, 'Fine animated film grain.'),
    number('warmth', 'Warmth', 0.25, -1, 1, 'Cool blue to warm amber color response.'),
    unit('fade', 'Faded blacks', 0.15, 'Lift shadow tones gently.'),
    unit('exposureDrift', 'Exposure drift', 0.1, 'Slow, bounded exposure variation without flashes.'),
  ]),
  manifest('pixelate', 'Pixelate', 'Resample the visual into crisp blocks of pixels.', [
    intensity(1), integer('pixelSize', 'Pixel size', 8, 1, 96, 'Block width in drawing-buffer pixels.'),
    number('gridAspect', 'Grid aspect', 1, 0.25, 4, 'Stretch pixel blocks horizontally or vertically.'),
  ]),
  manifest('ordered-dither', 'Ordered Dither', 'Reduce color levels with a patterned retro-computer texture.', [
    intensity(), integer('patternSize', 'Pattern size', 2, 1, 12, 'Physical pixel size of each Bayer-pattern cell.'),
    integer('levels', 'Color levels', 8, 2, 32, 'Available levels per color channel.'),
    unit('strength', 'Pattern strength', 0.5, 'Amount of patterned threshold variation.'),
  ]),
  manifest('chromatic-aberration', 'Chromatic Aberration', 'Lens-like color separation concentrated toward the image edges.', [
    intensity(), unit('amount', 'Amount', 0.3, 'Maximum color-channel displacement.'),
    number('direction', 'Direction', 0, -180, 180, 'Direction of channel separation in degrees.', 1),
    unit('edgeBias', 'Edge bias', 0.75, 'Concentrate separation at the edges instead of uniformly.'),
  ]),
  manifest('kaleidoscope', 'Kaleidoscope', 'Mirror the image into rotating, symmetrical wedges.', [
    intensity(1), integer('segments', 'Segments', 6, 2, 16, 'Number of mirrored wedges.'),
    number('rotation', 'Rotation', 0, -180, 180, 'Rotate the symmetry in degrees.', 1),
    ...centers(), number('zoom', 'Zoom', 1, 0.5, 3, 'Scale the mirrored input.'),
  ]),
  manifest('dream-blur', 'Dream Blur', 'A soft spatial haze that gently blends nearby shapes.', [
    intensity(), number('radius', 'Radius', 3, 0, 16, 'Blur radius in drawing-buffer pixels.', 0.25),
  ]),
  manifest('digital-glitch', 'Digital Glitch', 'Occasional horizontal block displacement and color misalignment.', [
    intensity(), unit('frequency', 'Frequency', 0.15, 'How often local glitches appear; zero stops new glitches.'),
    unit('displacement', 'Displacement', 0.15, 'Bounded horizontal displacement of affected blocks.'),
    integer('blockSize', 'Block size', 24, 4, 96, 'Height of each glitch band in physical pixels.'),
    unit('colorSplit', 'Color split', 0.1, 'Color-channel misalignment within affected blocks.'),
  ]),
  manifest('lens-distortion', 'Lens Distortion', 'Barrel or pincushion distortion without a television frame.', [
    intensity(1), number('distortion', 'Distortion', 0.2, -1, 1, 'Negative pincushion to positive barrel distortion.'),
    number('zoom', 'Zoom', 1, 0.5, 2, 'Scale the distorted image.'), ...centers(),
  ]),
  manifest('color-grade', 'Color Grade', 'Shape the finished image mood independently of the visual palette.', [
    intensity(), number('warmth', 'Warmth', 0, -1, 1, 'Blue to amber white-balance shift.'),
    number('tint', 'Tint', 0, -1, 1, 'Green to magenta color balance.'),
    number('contrast', 'Contrast', 1.08, 0, 2, 'Contrast around mid-gray.'),
    number('saturation', 'Saturation', 0.95, 0, 2, 'Grayscale through heightened color.'),
    unit('fade', 'Faded blacks', 0.05, 'Lift shadows without replacing highlights.'),
  ]),
  manifest('vignette', 'Vignette', 'Softly shade the edges to frame the composition.', [
    intensity(), unit('strength', 'Strength', 0.35, 'Blend the edges toward the chosen color.'),
    unit('radius', 'Radius', 0.65, 'Size of the clear central area.'),
    unit('softness', 'Softness', 0.4, 'Width of the feathered edge transition.'),
    { name: 'edgeColor', label: 'Edge color', type: 'color', default: '#000000', description: 'Color used to shade the edges.' },
  ]),
  manifest('bloom', 'Bloom', 'Bright areas cast a soft, thresholded glow using multiple GPU passes.', [
    intensity(), unit('threshold', 'Threshold', 0.65, 'Only brighter tones generate glow.'),
    number('radius', 'Radius', 4, 1, 16, 'Separable blur radius in drawing-buffer pixels.', 0.25),
    unit('strength', 'Strength', 0.4, 'Brightness of the glow added to the original.'),
  ]),
  manifest('liquid-glass', 'Liquid Glass', 'Refract the image through slowly drifting waves.', [
    intensity(), unit('strength', 'Refraction', 0.2, 'Amount of refracted displacement.'),
    number('scale', 'Wave scale', 4, 1, 12, 'Number of waves across the image.'),
    number('speed', 'Wave speed', 0.3, 0, 2, 'Effect motion speed, independent of the visual.'),
  ]),
  manifest('halftone-print', 'Halftone Print', 'Translate brightness into a rotated field of printed dots.', [
    intensity(), integer('dotSize', 'Dot size', 6, 2, 24, 'Distance between dots in drawing-buffer pixels.'),
    number('angle', 'Screen angle', 45, -180, 180, 'Rotate the dot screen in degrees.', 1),
    { name: 'invert', label: 'Invert ink', type: 'bool', default: false, description: 'Switch between dark ink on light paper and light ink on dark paper.' },
  ]),
  manifest('datamosh-trails', 'Datamosh / Trails', 'Blend persistent previous frames into trails or displaced video blocks. Uses additional history textures.', [
    intensity(), { name: 'mode', label: 'Mode', type: 'select', default: 'Trails', options: ['Trails', 'Datamosh'], description: 'Smooth trails or block-displaced frame feedback.' },
    unit('persistence', 'Persistence', 0.65, 'Amount of previous-frame image retained.'),
    unit('decay', 'Decay', 0.95, 'How much brightness the retained image keeps.'),
    unit('displacement', 'Displacement', 0.1, 'Spatial movement of retained frames.'),
    integer('blockSize', 'Block size', 24, 4, 96, 'Size of datamosh blocks in physical pixels.'),
  ]),
  manifest('palette-mapping', 'Palette Mapping', 'Map the finished image brightness onto a selected color ramp.', [
    intensity(), { name: 'palette', label: 'Palette', type: 'select', default: 'Neon', options: ['Neon', 'Ember', 'Ocean', 'Monochrome'], description: 'Color ramp applied to image luminance.' },
  ]),
].map(item => [item.id, item]));
