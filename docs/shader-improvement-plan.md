# Shader improvement plan

Review date: 2026-09-27. Planning only; no application changes.

## Direction and evidence

Make each shader easier to art-direct: useful controls, deliberate palettes, continuous motion, and recognizable material character. Preserve existing shader IDs and saved looks. The user's selected priority is **more expressive editing controls**. Repair editing correctness first, then expand effect-specific controls and their color support; follow with visual refinement and measured performance.

Reviewed the registry (53 shaders), manifest/control and palette infrastructure, runtime, import adapter, existing validation harness, and representative GLSL implementations. Inspected live settings and representative output through the collaborative browser using a temporary build of current source and an in-memory configuration stub. This was not an exhaustive visual or GPU benchmark of all shaders.

The project already has grouped controls, advanced settings, numeric entry, per-control reset, conservative numeric randomization ranges, saved looks, color schemes, dithering in several shaders, and substantial render checks. Extend these rather than rebuilding them.

Leitfaden MCP is not exposed in this session, so this document is the local plan; no project-management records were created.

## 1. Repair editing correctness — first implementation slice

**Confirmed: Flow Field glow controls are unreachable.** `flow-field/manifest.ts` uses `visibleWhen: { name: "trail", value: 1 }` for glow strength and width. The control stores a boolean, and `uniformVisible` compares strictly. Both rows remained hidden in the live browser with Edge glow checked.

- Change the dependency to `true` and validate dependency values against their parent types across all manifests.
- Test the actual UI toggle and preservation of hidden values. The current manifest test validates select dependencies but misses boolean type mismatches.

**Confirmed: Randomize breaks inherited scheme colors.** `randomizeUniforms` first fills missing stored values with manifest defaults. Protected colors are skipped during randomization, but those defaults are returned and stored; stored values then override the scheme. Reproduced with Flow Field and Dracula: primary `#bd93f9` became `#44ccff` and background `#282a36` became `#040814`.

- Randomize eligible explicit overrides without materializing protected inherited values. Keep scheme inheritance live; copying resolved colors into storage would also mask future scheme updates.
- Cover global/per-shader schemes, explicit custom colors, dependent palette selectors, and subsequent scheme changes.

**Source-derived: reset state disagrees with inheritance.** Reset deletes the stored override, but its disabled state compares the effective value with the built-in default. With a scheme, an inherited color can keep Reset enabled even when reset cannot change it; a custom value equal to the built-in default can disable Reset even when an override exists.

- Define reset as removing an override and returning to the inherited value. Base availability on override presence and show the inherited target where useful.
- Distinguish “From scheme,” “Built-in,” and “Custom” in the color controls and scheme status.

Acceptance: glow controls appear correctly; Randomize preserves both visible scheme colors and inheritance; Reset accurately reflects whether an override exists. Existing saved looks still load.

Primary files: `src/settings/shader-controls.ts`, `src/settings/index.ts`, `src/renderer/core/uniforms.ts`, `src/renderer/shaders/flow-field/manifest.ts`, `tests/shader-manifests.test.ts`, and palette/settings tests.

## 2. Make colors intentional and editable

**Current gaps:** 28 imported shaders have only Speed, Contrast, Brightness, and Saturation, with no color uniforms. Scheme roles are inferred from uniform names. Native color pickers have no adjacent hex field. With no active scheme, Randomize independently samples arbitrary RGB colors.

- Add optional explicit color-role metadata to manifests, with the current name mapping as a compatibility fallback. Roles should describe the material: paper/pigment for Ink Bloom, sky/curtain for Aurora, metal/reflection for Liquid Chrome, background/emission for glow effects.
- Give each shader descriptive labels instead of generic “Primary color” where a concrete role is available.
- Add editable hex values beside swatches, role-aware palette previews, and a clear indication of inherited versus custom values.
- Separate randomizing motion/shape from randomizing color. Add color locks and one-step undo so exploration is recoverable.
- Generate related colors from constrained hue, chroma, and lightness ranges; preserve appropriate light/dark relationships. Offer a small set of curated palettes per material. Keep expressive rainbow modes available where they define the shader.
- Avoid mapping every background directly to a terminal theme's surface. For example, Ink Bloom should offer a light-paper interpretation as well as a deliberate dark-paper variation.

**Rendering policy:** the runtime passes hex RGB components directly to shaders. Older shaders multiply brightness, newer shaders often use exponential exposure, and imports may already contain gamma or tone transformations. Do not apply a blanket conversion to the collection.

- Classify each shader's existing color path before introducing shared helpers. Separate authored gradient interpolation from lighting/exposure where appropriate.
- Prototype controlled highlight rolloff for Flow Field, whose reciprocal edge glow can exceed the display range; compare bright-detail retention against its existing look.
- Prototype a paper-preserving finish for Ink Bloom: its current exposure transform dims even the light paper background at default brightness. Retain the current treatment as a compatible look if the result changes substantially.
- Share established output/dither helpers at build time only after validating representative results. Preserve upstream notices and avoid double tone mapping imported shaders.

Acceptance: users can enter exact colors, understand their roles, preserve them while varying shapes, and recover the previous result. Palette variants retain readable structure on both light and dark treatments. Record before/after frames for any rendering-policy change.

## 3. Expand controls by shader family

Add a few perceptually meaningful controls per effect. Keep the primary inspector focused; put technical or fine adjustments in Advanced. Treat the following as candidates whose ranges must be established visually, not as prevalidated parameters.

| First candidates | Useful additions or refinements | Visual aim |
| --- | --- | --- |
| Digital Rain and shader clocks | Foreground/glow/background colors; glyph density or size; glow width; clock format and seconds where applicable | Readable luminous forms with controllable intensity |
| Water Ripples and selected ocean shaders | Water/deep-water/highlight roles; wave amplitude, wavelength, ripple spacing; camera or light angle when supported by that source | Separate water structure from illumination |
| Cloudscape and selected landscapes | Sky/fog/sun/material colors; cloud coverage or terrain scale; camera height and light direction | Depth and atmospheric separation |
| Flow Field | Repair glow controls, then make palette-dependent controls honest: Mono currently ignores background while Edge glow can reintroduce the primary color | Controllable currents with distinct bright edges |
| Ink Bloom | Paper tone, pigment spread, edge softness, fine-detail balance; composition seed | Feathery pigment and quiet paper areas |
| Liquid Chrome / Opal Film | Reflection width/intensity, material tint, highlight tint; independent fine-detail evolution | Recognizable material response across palettes |
| Star Drift / Ember Drift / Paper Lanterns | Recoverable seed and placement variation; distinguish travel speed from twinkle, fade, or sway where useful | Varied populations with smooth entrances and exits |
| Reactive shaders | Effect-specific shape controls and separate audio influence on brightness versus deformation | Calm ambient motion with bounded audio response |

Stage imports in small batches: clocks/Digital Rain first, then water, then atmospheric and computationally heavier effects. Keep an “Original” treatment and defaults that reproduce current output. Implement changes in the import adapters/manifest generation path as well as generated shader files, so re-importing does not erase them.

Improve control semantics alongside additions: label frequency-based “Scale” controls as pattern density or explicitly explain their direction; add missing degree units; use perceptual slider mappings for widths, density, and speed where linear travel wastes useful range. Preserve numeric storage and legacy values.

Acceptance: every exposed control has a meaningful visible effect in its applicable mode, safe endpoints, clear units, and a useful adjustment range. Original imported appearances and old saved values remain recoverable.

## 4. Make motion edits continuous

Most shaders calculate `uTime * speed`; changing speed therefore changes the entire elapsed phase. Setting speed to zero selects the time-zero composition rather than holding the current frame. Existing checks compare renders that both start with speed zero, so they do not test this transition.

- Introduce an integrated animation clock for built-in shaders: accumulate elapsed delta scaled by speed, preserving phase through edits and pause/resume.
- Keep wall-clock date/time, audio smoothing time, and artistic animation time separate. Preserve audio response at zero motion speed. Decide shader-clock freeze semantics explicitly rather than inheriting them accidentally from the animation clock.
- Keep the custom shader time contract compatible; do not silently apply speed twice. Add a capability/version boundary if required.
- Handle long gaps after a hidden window or resume explicitly. Verify frame pacing at the configured target rather than assuming the current threshold loop delivers it exactly.
- Add recoverable seeds only to effects with meaningful randomness, and persist those seeds in saved looks.

Acceptance: dragging speed does not jump the composition; pause holds the current frame; resume continues it; reactive audio behaves as documented; equal elapsed time produces equivalent motion at different frame rates.

## 5. Validate visual quality and measure cost

- Capture representative frames before changes, at defaults and selected saved looks. Include all 53 shaders in compilation and manifest coverage, then inspect changed shader families in detail.
- Extend the existing harness with scheme → randomize → reset → save/reload sequences, live speed changes, color-mode dependencies, and combinations of extreme parameters.
- Existing extreme/long-time checks mostly verify rendering and GL errors. Add image diagnostics for isolated black speckles, unintended clipping, and loss of structure, with shader-specific exceptions for intentional black/white output.
- Review changed effects at thumbnail, ordinary preview, portrait, ultrawide, 1080p, and 4K sizes. Watch at least 60 seconds of continuous animation; sampling a timestamp of 86400 is not a continuous-motion test.
- Profile expensive imported raymarchers and noise shaders on hardware. Existing 1080p software rendering/readback timings are regression signals, not hardware frame rates.
- Only then introduce measured quality tiers for render resolution, ray steps, or noise octaves. Keep quality controls separate from artistic controls and retain the existing shared thumbnail context and offscreen-thumbnail suspension.
- Check shader compilation and visuals in both supported WebGL versions. Run the existing typecheck, unit tests, shader checks, and relevant custom/reactive checks during implementation.

Acceptance: documented visual improvements with comparable frames, stable long runs and edge cases, preserved custom/preset behavior, and measured performance within the selected frame budget on recorded hardware.

## Recommended delivery order

1. Correctness fixes and focused regressions.
2. Expressive controls in small shader-family batches, starting with clocks/Digital Rain and water. Establish descriptive labels, units, useful ranges, and advanced grouping. Include color-role metadata and exact color entry needed by those controls.
3. Continuous animation time and pause behavior, plus independent motion components where they materially expand control.
4. Exploration tools: parameter/color locks, scoped randomization, one-step undo, and recoverable composition seeds. Refine palette generation and color rendering against the expanded controls.
5. Remaining shader-family coverage, visual refinement, and hardware-driven quality tuning.

The first feature milestone is a small set of imported shaders whose silhouette, motion, and palette can be changed independently, saved as distinct looks, and restored exactly. Ship and evaluate that complete editing workflow before adding controls to all 28 imports. Thematic sections above describe the work; this delivery order sets its priority.

Validation accompanies each slice. Avoid a collection-wide renderer rewrite, new rendering framework, or wholesale change to saved-look appearance as part of this work.

## Implementation status (2026-09-27)

Delivered for slices 1–5 of the delivery order. The implementation was interrupted by a provider
usage limit; this section records what shipped and the validation that was completed afterwards.

**Editing correctness.** Flow Field's glow controls now use a boolean dependency and every
manifest dependency is validated against its parent's type. Randomize stores eligible overrides
only, so inherited scheme colors stay live. Reset is override-aware and each color shows whether it
is Custom, From scheme or Built-in. Exact hex entry, parameter locks, scoped randomization and
one-step Undo are available in the inspector.

**Colors.** Manifests carry optional `colorRole` metadata with the name mapping as fallback, and
imported shaders expose an opt-in `palette: original|custom` tonal treatment (`schemePalette:
'custom'`). The tonal map soft-compresses the source range so dark, middle and bright tones all
respond, including on bright cloudscapes and ripples.

**Controls.** Clocks (digit size, 12-hour, seconds, glow and LED texture), Digital Rain (glyph
fill/stroke/glow, rain drift), water (wave height/density, crest sharpness, drop size), clouds,
terrain and field gained structural controls; flow-field, ink-bloom, liquid-chrome, opal-film,
star-drift, ember-drift, paper-lanterns and the reactive shaders gained material, seed and
audio-shaping controls.

**Motion.** Built-ins consume an integrated `AnimationClock` phase with the speed uniform fixed to
one, so changing speed preserves position and pause holds the frame; custom shaders keep elapsed
`uTime` plus the speed uniform. Frame pacing keeps its cadence across refresh rates, drops hidden
time, and imported clock dates wrap at midnight.

**Validation.** `npm run typecheck`, 215 unit tests, `npm run check-shaders` (all 53 shaders in
WebGL 1 and 2 plus the settings/preview/preset/IPC flow, 2758 checks per context),
`npm run check-reactive-audio` and the new `npm run check-animation-runtime` all pass.
`npm run check-custom-shaders` fails identically at the pre-session commit: the built settings
gallery never renders a `[data-category="Custom"]` group, so the check's selector is stale. That is
unrelated to this work and remains open.
