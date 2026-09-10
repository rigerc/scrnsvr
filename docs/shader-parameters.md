# Shader parameters

Controls are grouped into Motion, Shape, and Color. Open Advanced for additional adjustments. Sliders and numeric inputs share the same range and step; direct numeric entry commits on Enter or when you leave the field. Reset beside a control restores only that parameter. Presets save the whole combination of overrides.

Speed controls the whole animation, including secondary motion and twinkling. Zero freezes it. Brightness changes light intensity, while saturation adjusts color intensity (0 = grayscale, 1 = original colors). Aurora Veil retains its existing brightness control for the light curtains.

| Shader | Additional adjustments |
|---|---|
| Aurora Veil | 1–5 curtains, vertical position, wave amplitude, fold detail, upper and lower sky colors |
| Flow Field | Direction, turbulence, edge glow strength and width, background, Duotone secondary color |
| Gradient Blobs | Movement range, horizontal/vertical stretch, size variation, breathing, halo strength |
| Gradient Drift | Starting angle, rotation and drift rates, warp frequency, midtone position |
| Orbital Interference | Orbit radius and stretch, ring expansion, line thickness, intersection glow, background |
| Mesh Gradient | Movement range, horizontal/vertical spread, warp frequency, influence of each of the four colors |
| Chromatic Plasma | Direction, diagonal wave distortion, radial waves, palette offset, three custom colors |
| Silk Ribbons | 1–8 ribbons, spacing, angle, wave frequency, edge sheen, background |
| Star Drift | Star size, halo amount, drift direction, parallax, twinkle rate, background |
| Tidal Caustics | 1–4 layers, distortion, wave complexity, direction, depth shading |
| Ember Drift | Ember size and variation, rise direction, sideways wander, fade duration, haze, background |
| Contour Dunes | Line thickness, edge softness, terrain distortion, fine detail, angle, contour intensity |
| Opal Film | Surface scale, iridescence, surface distortion, sheen, background |
| Kinetic Tiles | Tile density, spacing, rotation amount, wave delay, slide, background |
| Ink Bloom | Bloom scale, curl, pigment density, feather detail, paper background |
| Phosphor Garden | 4–20 stems, curvature, pulse rate, growth, background |
| Rain Glass | Rain density, streak length, background blur, refraction, background |
| Guilloché | 3–16 symmetry lobes, line spacing, weave, rotation rate, line width, background |
| Liquid Chrome | Ripple scale, roughness, distortion, light angle, background |
| Prism Mosaic | Cell density, edge glow, distortion, bevel width, background |
| Paper Lanterns | 4–20 lanterns, sway, translucency, size, background |
| Magnetic Filaments | 2–6 poles, pole spacing, line density, curvature, background |

Direction and angle controls are offsets in degrees from the original composition or motion. Negative rotation, drift, and expansion rates reverse that component; overall Speed still governs all animation. Size and intensity controls use the shader's own scale, as explained beneath each control. Fine edges remain softened at small preview sizes to reduce shimmer.

Plasma shows custom colors only with the Custom palette. Noctalia import selects that palette automatically. Flow Field shows its secondary color in Duotone mode, and glow strength/width only when Edge glow is enabled. Hidden controls keep their saved values.

Randomize uses conservative ranges near the original appearance, preserves background colors, and respects dependent controls and numeric steps. Manual controls expose wider ranges. Old presets remain readable and retain their existing values; missing parameters use their defaults without rounding previously saved floating-point values to newer slider steps.

Parameter definitions, including exact ranges, steps, defaults, and randomization ranges, live in each shader's `src/renderer/shaders/<id>/manifest.ts`.

## Validation

Run `npm run typecheck`, `npm test`, and `npm run check-shaders`. The last command uses Electron with software WebGL on a desktop display or Xvfb. It checks both WebGL versions, parameter effects and extremes, grayscale and paused animation, several aspect ratios, simulated long runs, and settings interactions. Its 1080p readback timings include software rendering and are not hardware frame-rate measurements.
