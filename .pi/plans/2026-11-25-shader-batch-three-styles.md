---
title: "Shader batch: light in the dark, fine line art, material surfaces"
status: implemented
created: "2026-11-25"
type: feature
---

# Shader batch: three styles

**Planning only.** Additive: no existing shader id, manifest, saved look or palette changes.
Supersedes the Electron-era batch plans (`2026-09-27-new-shader-batch-1.md`, `…-batch-2.md`),
whose paths (`src/renderer/shaders`, `npm run check-shaders`) no longer exist.

The 41 shaders fall into six styles: flat paper-cut (16), light in the dark (7), fine line
art (4), soft-focus haze (5), full-frame colour wash (4) and material surfaces (5). This batch
adds to three of them, each as its own track:

| Track | Style | Core | Optional |
|---|---|---|---|
| A | Light in the dark | 5 | 2 |
| B | Fine line art | 4 | 2 |
| C | Material surfaces | 4 | 2 |

All 13 core shaders are original, single-pass and texture-free.

## Rules every track shares

- **Dual-dialect GLSL:**
  - `#ifdef SCRNSVR` declares the uniforms.
  - `#else` has `const` defaults plus `#define uTime iTime` / `uResolution iResolution.xy`.
  - Entry point is `mainImage`.
- **`finish()` uses the exposure curve:** `1 - exp(-color * brightness)`, then the static
  fragcoord dither, then saturation. It is not the Geometric clamp variant.
- **Coordinates are normalised to the height:**
  `p = (fragCoord/uResolution - 0.5) * vec2(aspect, 1)`.
- **Time:** `t = uTime * speed` is the only time source. Loops use constant bounds plus
  `continue`/`break`.
- **No derivatives.** No built-in uses `fwidth`/`dFdx`, because GLSL ES 1.00 lacks them
  without an extension. Anti-alias with analytic gradients instead:
  - Guilloche: `d = |f| / |∇f|`.
  - Magnetic Filaments: a pixel-width line from the field gradient, faded out where it
    would go below one pixel.
  - Liquid Chrome: analytic slopes for normals.

  This is the main craft constraint for tracks B and C.
- **Manifest boilerplate:**

  | Uniform | Settings |
  |---|---|
  | `speed` | Motion, 0–2, default 0.3, random 0.1–0.6, "Overall animation speed; zero freezes all movement." |
  | `brightness` | Color, 0–2, random 0.7–1.3, "Overall light intensity." |
  | `saturation` | Color, 0–2, `advanced: true`, random 0.7–1.3, "Color intensity; zero is grayscale." |
  | `background` | `random: false` |

  Other controls get random ranges of about ±20% around the default. Descriptions are one
  sentence about the subject.

## Track A: light in the dark

**Look:** sparse lines, Gaussian halos and points of light added over a near-black blue
(`#07121b`, `#090f20`, `#0a1425`). Each shader is a natural phenomenon, observed calmly, in two
light colours. **Skeleton:** `data/shaders/magnetic-filaments/`. **Template, 10 uniforms,
Ambient:**
1. `speed`
2. Four phenomenon controls (usually one `int`), split between Shape and Motion
3. `brightness`, `saturation` (advanced)
4. `color1`, `color2`, `background`

No `colorRole`; `scene.rs:144` maps colour roles by name. The light is added:
`color = background + Σ tint * light`.

| id | Title | Phenomenon | Controls |
|---|---|---|---|
| `star-trails` | Star Trails | long-exposure circumpolar arcs | `density` (S), `trailLength` (S), `poleOffset` (S), `twinkle` (M) |
| `sunken-light` | Sunken Light | underwater sunbeams and drifting specks | `rayCount` (int, S), `depth` (S), `motes` (S), `sway` (M) |
| `medusa-drift` | Medusa Drift | glowing jellyfish | `jellyCount` (int 2–6, S), `bellSize` (S), `tentacleLength` (S), `pulseRate` (M) |
| `glow-wire` | Glow Wire | one tumbling luminous torus knot | `knot` (int 2–5, picks p:q, S), `size` (S), `glow` (S), `tumble` (M) |
| `incense-smoke` | Incense Smoke | thin smoke strands rising | `wispCount` (int, S), `turbulence` (S), `height` (S), `drift` (M) |

1. **Star Trails.** "Long-exposure star trails wheel in quiet arcs around a hidden pole."
   - Polar coordinates around an off-screen or corner pole.
   - The radius is split into rings. A hash in each ring sets one arc's start angle,
     length, brightness and its colour between `color1` and `color2`.
   - Constant cost per pixel. The anti-aliased ring width comes from `r`, and arcs fade
     near the pole.
2. **Sunken Light.** "Shafts of sunlight sway down through deep water, catching slow
   drifting motes."
   - Fan-shaped shafts start from a rippling surface glow and fade exponentially with depth.
   - Sparse specks drift slowly and get brighter inside the shafts.
   - It complements Tidal Caustics, which looks down at the seabed. Check for banding at 4K
     and low brightness.
3. **Medusa Drift.** "Translucent jellyfish pulse slowly upward, their rims and trailing
   tendrils glowing in the deep."
   - The bell rims glow in `color1`. Sine-displaced tendrils trail in `color2`.
   - Each contraction moves the bell upward, and it wraps at the top.
   - Skip jellies whose bounding box doesn't contain the pixel. Use additive light only
     (no solid fill) so it never reads as clip art.
4. **Glow Wire.** "A single filament of light traces a slowly tumbling knot in the dark."
   - A 3D torus-knot curve rotated slowly on two axes, sampled as 96 projected segments.
   - Depth maps the colour from `color2` (far) to `color1` (near) and dims the far side.
   - Measure the cost, and close the loop exactly so there's no seam.
5. **Incense Smoke.** "Thin ribbons of smoke curl upward from unseen embers and dissolve
   into the dark."
   - Two or three strands start at the bottom edge. Each one bends with noise that grows
     with height, and it widens and dims as it rises.
   - Strands only, no volume fill. **Drop it if the thumbnail reads like Ink Bloom or
     Reactive Bass Bloom.**

**Optional:** `moon-pond` (a moon's reflection broken up by spreading ripple rings) and
`glow-tide` (glowing breaking waves; this is the third water shader, so ship only if it
clearly differs from Sunken Light). **Rejected:** fireflies (Ember Drift), nebula (Aurora
Veil and Ink Bloom), fibre optics (Phosphor Garden), neon signs (too literal), lightning
(too energetic).

## Track B: fine line art

**Look:** many thin, even, crisp lines in two colours on a dark ground, like an engraving,
plotter drawing or technical figure. The motion is slow drift, not flashing. Lines are about
1–2.5 px and never go below one pixel. They get a slight additive glow
(`exp(-d·k) * 0.08`, as in Guilloche). **Skeleton:** `data/shaders/guilloche/`. **Template,
11 uniforms:**
1. `speed`
2. Four controls (usually one `int` count), split between Shape and Motion
3. `lineWidth` (Shape, advanced, 0.5–2.5, default 1, "Thickness of the fine … lines.")
4. `brightness`, `saturation` (advanced)
5. `color1` "Primary color", `color2` "Secondary color", `background`

No `colorRole`.

Already covered: rosette (Guilloche), topographic contours (Contour Dunes), ring interference
(Interference), caustic network (Tidal Caustics), field lines (Magnetic Filaments). Missing:
**tone shown by line thickness**, **hidden-line landscapes**, **straight-line envelopes** and
**tables of figures**.

| id | Title | Category | Line grammar | Controls |
|---|---|---|---|---|
| `engraved-sea` | Engraved Sea | Ambient | horizontal hatching whose width follows wave shading | `lineSpacing` (S), `waveHeight` (S), `shading` (S), `swell` (M) |
| `ridgelines` | Ridgelines | Ambient | stacked horizon lines with hidden-line removal | `ridgeCount` (int 12–48, S), `peakHeight` (S), `roughness` (S), `drift` (M) |
| `string-art` | String Art | Geometric | straight chords between pins forming curved envelopes | `pins` (int 60–200, S), `size` (S), `multiplier` (S), `morph` (M) |
| `lissajous-table` | Lissajous Table | Geometric | a grid of Lissajous figures, one frequency ratio per cell | `gridSize` (int 3–6, S), `padding` (S), `complexity` (S), `phaseDrift` (M) |

1. **Engraved Sea.** "Fine engraved lines swell and thicken as slow waves roll beneath them."
   - Evenly spaced near-horizontal lines are displaced vertically by a sum of slow waves.
   - Each line's **thickness** follows the shading of the wave slope (thicker in the
     troughs, thinner on lit crests), the way copper-plate engraving shows tone. `shading`
     sets how strongly.
   - Distance to the line is `|y - y0(x)| / sqrt(1 + y0'(x)²)` with an analytic `y0'`.
   - *Risk:* shimmer where crests bunch lines together. Clamp the spacing to at least 4 px
     at 1080p.
2. **Ridgelines.** "Layered mountain ridgelines drift past in quiet, hand-plotted strokes."
   - Draw the ridges back to front in a constant 48-step loop.
   - Each ridge is a 1D noise profile. Its line is drawn, and the area under it
     **erases** the ridges behind it (hidden-line removal), which gives a plotter-drawn
     landscape.
   - Depth fades the colour from `color1` (near) to `color2` (far). The profiles scroll
     sideways with `drift`.
   - *Avoid:* the well-known one-centred-peak, white-on-black composition. Use a wide,
     natural mountain range with perspective spacing instead.
3. **String Art.** "Taut threads stretched between pins weave slowly shifting curves of
   light."
   - `pins` points sit on a circle. Pin `i` connects to `(i·multiplier) mod pins`.
     `multiplier` drifts slowly with `morph`, so the envelope moves through the cardioid,
     nephroid and beyond.
   - Per-pixel cost is up to 200 point-to-segment distances, early-out past the circle.
     Overlapping threads add up, so dense areas glow.
   - *Risk:* where threads converge they saturate. Tone-map each thread's contribution
     (e.g. `0.35 / sqrt(pins)`).
4. **Lissajous Table.** "A table of Lissajous figures traces every frequency ratio in
   unhurried harmony."
   - A grid of cells. Row `i` and column `j` give the frequency ratio `(i+1):(j+1)`, up
     to `complexity`.
   - Each pixel tests only its own cell's curve (64–96 segments). The phase drifts with
     `phaseDrift`, so every figure turns slowly in 3D.
   - Row and column headers show a single circle each, as in the classic table. Diagonal
     cells (1:1, 2:2) collapse to ellipses, which is expected.

**Optional:** `cross-hatch` (a slowly turning sphere or torus shaded only by hatch lines whose
density follows the lighting; same technique as Engraved Sea, so ship at most one unless
both read clearly differently) and `growth-rings` (wood cross-section rings born at an
off-centre pith with radial cracks; overlaps Interference and Contour Dunes). **Rejected:**
harmonograph (same curve technique as Glow Wire), wind-map streamlines (contours of a
stream function look like Contour Dunes), spirograph (Guilloche), moiré grids (shimmer
risk, and a different, high-frequency style).

## Track C: material surfaces

**Look:** the full frame is one physical material under slowly moving studio light. The
surface comes from an analytic height or orientation field, giving a normal; the normal is
reflected against soft studio light bands. No dark empty space and no objects.
**Skeleton:** `data/shaders/liquid-chrome/`. **Template, 13 uniforms, Ambient,
with explicit `colorRole`s:**
1. `speed`
2. `scale` (Shape)
3. Two material controls (Shape)
4. One light control (Color, e.g. `lightAngle` −180–180, as in Liquid Chrome)
5. `brightness`, `saturation` (advanced)
6. `color1` (`primary`), `color2` (`secondary`), `background` (`surface`, the shadow colour)
7. `highlightColor` (`onSurface`, advanced, "Studio light")
8. One more advanced control (a Motion rate or a reflection width)

Give the colours material names ("Metal tint", "Shadow"), as Liquid Chrome does.

Already covered: liquid metal (Liquid Chrome), thin-film iridescence (Opal Film), pigment in
paper (Ink Bloom), bevelled glass (Prism Mosaic), glowing cells (Flow Field). Missing:
**fabric sheen**, **directional brushed highlights**, **sparkle flakes** and
**chatoyance** (the moving shimmer in polished wood).

| id | Title | Optical effect | Material controls |
|---|---|---|---|
| `crushed-velvet` | Crushed Velvet | grazing-angle sheen on pile fabric whose direction changes in patches | `scale`, `crush` (S), `pile` (S), `lightAngle` (C); adv. `lightOrbit` (M) |
| `brushed-steel` | Brushed Steel | anisotropic highlight streaks across circular brushing | `scale`, `grain` (S), `warp` (S), `lightAngle` (C); adv. `streakWidth` (C) |
| `gold-lacquer` | Gold Lacquer | tiny gold flakes glinting in deep lacquer | `scale`, `flakeDensity` (S), `flakeSize` (S), `shimmer` (M); adv. `glossWidth` (C) |
| `burled-wood` | Burled Wood | polished burl whose shimmer band slides as the light moves | `scale`, `figure` (S), `grain` (S), `chatoyance` (C); adv. `lightOrbit` (M) |

1. **Crushed Velvet.** "Light slides across crushed velvet, catching the pile where it turns
   away."
   - A slow noise field sets the pile direction per patch.
   - The sheen is a grazing-angle term `pow(1 - N·L', k)` that brightens where the pile
     tilts away from the viewer. Combined with the patch direction, this gives the crushed
     look of dark cores with bright rims.
   - `pile` sets the sheen width, and the light orbits slowly.
   - *Risk:* it can read as Liquid Chrome. Keep the highlights broad and soft, with no
     sharp studio strip, and keep `highlightColor` subtle.
2. **Brushed Steel.** "A brushed steel dial turns its fine grain through a slow sweep of
   studio light."
   - Concentric brushing around an off-screen centre. The grain is a 1D hash along the
     radius, stretched along the angle, so there is no 2D noise.
   - The anisotropic highlight is strongest where the tangent is perpendicular to the
     light. This gives the classic radial **bowtie streak**, which rotates with `lightAngle`
     plus time.
   - `warp` adds gentle dents that bend the streak.
   - *Risk:* the grain aliases at 4K. Keep the grain period at least 2 px, or average 3
     taps along the radius.
3. **Gold Lacquer.** "Flecks of gold glint and fade within deep, glossy lacquer as the light
   drifts."
   - A deep lacquer ground (`background` black to `color2` oxblood or indigo) with one
     broad, soft gloss reflection.
   - Flakes come from a 3×3 cell search, each with a hashed tilt normal. A flake glints
     (in `color1`) only when its reflection lines up with the slowly sweeping light, so a
     few flakes sparkle at a time.
   - `shimmer` sets the sweep speed. Glints must stay at least 2 px and fade smoothly, so
     there is no single-pixel flashing.
4. **Burled Wood.** "Polished burl wood shimmers as light slides through its swirling
   grain."
   - Domain-warped rings around several burl "eyes" (`figure` sets the count and warp)
     produce the grain lines (`color1` light wood, `color2` dark grain).
   - **Chatoyance:** a gloss band whose position depends on grain direction × light angle,
     so it moves across the figure as the light orbits, like a tiger's-eye stone.
   - Light pores and varnish depth complete it.
   - *Risk:* reading as Contour Dunes, which is also flowing contours. Keep the grain
     lines soft and wide, and let the shimmer, not the lines, carry the look.

**Optional:** `hammered-copper` (dimpled metal from a 3×3 cell search, each dimple a
spherical cap normal; this would be a third metal) and `marbled-paper` (combed suminagashi
bands on paper, using Ink Bloom's `finish()` variant with `paperFidelity` for a light
background; high risk of overlapping Ink Bloom). **Rejected:** mercury pool (Liquid
Chrome), mother-of-pearl and dichroic glass (Opal Film), frosted glass (Rain Glass), satin
(Silk Ribbons).

## Workflow per shader

1. **Prototype in shadereye, using the repo file as it is.** The `#else` branch is plain
   Shadertoy, so `render_shader` / `render_animation` take the whole `shader.glsl` (verified
   on Quiet Arches this session; the old "dialect times out" warnings no longer apply).
   **shadereye flips Y**: Quiet Arches rendered upside down. Judge up and down (rising
   smoke, jellyfish, ridgelines, rays from the surface) only in `scrnsvr --preview`.
2. Render at 640×360, portrait 360×640 and ultrawide 960×270, plus a 1920×1080 crop for
   line and grain aliasing. Take a `render_animation` filmstrip of about 60 s of `uTime` to
   check that the motion never stalls, pops or wraps visibly.
   - Line art: use `probe_pixels` across a line to confirm it is 1–2.5 px with a smooth
     edge.
   - Materials: use `diff_shaders` against Liquid Chrome to confirm the new shader is
     clearly different.
3. Write `data/shaders/<id>/manifest.json` and `shader.glsl` from the track's skeleton. The
   directory name must equal `id`.
4. Check side by side against the track's reference shaders in
   `cargo run -p scrnsvr-app -- --preview --shader <id>` and in the settings bank grid.
   Exposure, darkness and pace should match.

## Repo touch points (once per batch)

| File | Change |
|---|---|
| `crates/scrnsvr-core/tests/fixtures/catalog.json` | Regenerate from `target/debug/build/scrnsvr-core-*/out/catalog.json` (shaders sort by directory, so new ids land in the middle) |
| `crates/scrnsvr-core/tests/catalog_sources.rs:30` | `41` → new total |
| `crates/scrnsvr-render/tests/headless.rs:304` | `41 + 17 + 3` → new total |
| `crates/scrnsvr-app/tests/cli.rs:343-344` | `41 of 41` and `41` → new total |
| `README.md:32` | "41 GLSL shaders" → new total |
| `crates/scrnsvr-core/tests/fixtures.rs:12` | **Leave at 41.** It counts the frozen v0.10.0 `messages.jsonl` |

`THIRD_PARTY_SHADERS.md` does not change, because everything here is original.

## Acceptance checklist (each shader)

- [ ] Matches its track's template. Every uniform is used and visibly changes the output.
- [ ] `speed = 0` freezes the frame. `saturation = 0` is exact grayscale. `brightness = 0` is black.
- [ ] The min and max of every numeric control render cleanly at `uTime = 86400`.
  Periodic phases use `mod` on the phase, not on the position.
- [ ] Lines and grain don't shimmer at 1080p or 4K. Thin features fade rather than going
  below one pixel.
- [ ] Reads well in portrait, landscape and ultrawide.
- [ ] Under a colour scheme (Nord, Gruvbox, Tokyo Night) the colours stay distinct. Track A
  and B backgrounds stay dark, and Track C materials still read as their material.
- [ ] The cost of the heaviest shaders (Glow Wire, String Art, Lissajous Table, Gold
  Lacquer) is recorded and sits in the collection's range.
- [ ] `cargo test --workspace` passes, including `every_builtin_shader_and_effect_compiles_and_links`.

## Phases

1. **Pilot, one per track:** Star Trails, String Art, Brushed Steel. These are the cheapest
   and most distinctive in each style. Wire up the count bumps and fixture regeneration
   here. ⏸ Checkpoint: screenshots plus test output, to confirm all three tracks hit their
   style before scaling up.
2. **Second wave:** Sunken Light, Engraved Sea, Crushed Velvet. ⏸ Checkpoint.
3. **Look-dev-heavy:** Medusa Drift, Glow Wire, Ridgelines, Gold Lacquer. Record the cost.
   ⏸ Checkpoint: screenshots, filmstrips, timing.
4. **Overlap-risk:** Incense Smoke, Lissajous Table, Burled Wood, each judged against the
   shader it might copy. Then decide on the optional shaders. ⏸ Checkpoint.
5. Release notes / version bump only on request.

Each phase lands as one commit with its own count bump and fixture regeneration. A dropped
shader never blocks the rest of its phase.

**Quality over quota:** if a new shader reads like an existing one in the thumbnail grid,
drop it. 13 core shaders would bring the catalog to 54, and a batch of 9 good ones beats 13
uneven ones.
