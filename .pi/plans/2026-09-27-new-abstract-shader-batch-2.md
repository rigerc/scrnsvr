---
title: "New abstract shader batch 2: Halftone Bloom, Voronoi Shatter, Moiré Lattice, Attractor Silk"
status: draft
created: "2026-09-27T19:52:23.889Z"
type: feature
---

# New abstract shader batch 2

**Planning only — no repo files changed.** Purely additive: no existing shader id,
manifest, palette, or saved look is touched. This is **batch 2**, sibling to
`.pi/plans/2026-09-27-new-shader-batch-1.md` (which is still unimplemented and covers
Umbra Dial / Loom Weave / Day Arc / Spectral Bloom). There is **no id overlap**: batch 1's
only Abstract entry is `loom-weave` (textile); this batch is print, cellular, interference
and attractor.

## Objective

Add abstract shaders that introduce **new visual grammars**, not a 17th soft gradient.
Every candidate below was prototyped in shadereye during this session; the four are chosen
because they are the abstract looks the 53-shader registry is missing entirely.

## Evidence: abstract category and material gaps

Registry = 53 shaders. Category counts (normalizing the mixed quote styles in
`src/renderer/shaders/*/manifest.ts`):

| Category | Count |
|---|---|
| Abstract | 17 |
| Ambient | 10 |
| Water | 6 |
| Landscapes | 6 |
| Digital | 5 |
| Space | 5 |
| Clocks | 3 |
| Reactive | 3 *(batch 1 addresses)* |

Abstract is the largest category, so **adding to it only makes sense when the grammar is
genuinely new.** Keyword sweep over every `shader.glsl`:

| Concept | Files containing it | Verdict |
|---|---|---|
| cellular / voronoi | 1 (`avs-field`, but only as an internal grass-noise helper — never visible as cells) | **absent as a look** |
| crack, fracture, shatter | 0 | **absent** |
| moiré, lattice, hexagon, triangl | 0 | **absent** |
| halftone, print, dot lattice | 0 | **absent** |
| attractor, lorenz, thomas | 0 | **absent** |
| kaleidoscope, spiral | 0 | **absent** |
| rings | 11 | saturated (`interference` is orbital rings) |
| grid | 6 | saturated (gradients/mosaics) |

So: no **print/graphic reproduction**, no **cellular tessellation**, no **interference
figures**, no **iterated dynamical systems**. All four are single-pass, texture-free,
GLSL ES 1.00-friendly — they fit the engine contract.

## shadereye findings (this session)

Recorded because they shape the workflow, and because two of them are cost traps:

1. **`render_shader` works reliably**, backend reported as `Vulkan`. All prototypes below
   rendered at 512×512 with no errors. This is the fast iteration loop.
2. **Shadertoy dialect only.** `mainImage(out vec4, in vec2)` + `iTime` + `iResolution`.
3. **Re-confirmed: the scrnsvr dialect times out.** A minimal `precision highp float;` +
   `uniform float speed; uniform vec2 uResolution; uniform float uTime;` +
   `gl_FragColor` shader was submitted and the request timed out. Matches batch 1's
   finding (confirmed there twice). **Do not paste `shader.glsl` into shadereye.**
4. **Re-confirmed: `validate_shader` is not a usable gate.** On the Voronoi prototype it
   returned `UnknownVariable("iResolution")` — it parses with GLSL/SPIR-V 450 semantics and
   neither knows Shadertoy inputs nor accepts ES 1.00 (`gl_FragColor`, bare `uniform`).
   Treat it as noise; the real gate is `npm run check-shaders`.
5. Clock (`iDate`) and audio (`iChannel`) are unavailable. **Neither matters for this
   batch** — all four shaders are pure time-only, so unlike batch 1 nothing here is
   unverifiable in shadereye.

**Workflow per shader:** prototype Shadertoy dialect → `render_shader` /
`render_animation` / `diff_shaders` → port to the contract → verify in-repo.

## Proposed shaders

### 1. `halftone-bloom` — "Halftone Bloom" — Abstract — **prototyped, strong**

Screen-print halftone: a rotated dot lattice whose dot radius is driven by a slow fBm
field, with the lattice direction itself warped by the field so the rows of dots shear and
ripple like a misregistered print. Two ink colours trade off across the field over cream
paper. Instantly reads as a printing artefact — nothing in the collection is graphic/print.

The rendered prototype shows the intended moiré-adjacent row shearing and a clean
two-ink split. One flaw to fix in the port: the per-pixel rotation warp produces a few
visible axis-aligned seams where the rotation gradient jumps; damp `warpAmount`'s gradient
(or rotate the whole lattice by a smooth low-frequency angle only) before shipping.

Controls: `speed` (Motion), `dotDensity`, `dotSize`, `warpAmount`, `inkSplit` (Shape),
`driftDirection` (Motion), `ink1` (primary), `ink2` (secondary), `paper` (surface),
`brightness`, `saturation` (Color).

Core of the prototype (Shadertoy dialect):

```glsl
vec2 warp = vec2(noise(p * 1.4 + t * 0.15), noise(p * 1.4 + 3.7 - t * 0.12));
vec2 q = p + 0.35 * (warp - 0.5);
float rot = (0.5 + 1.2 * noise(p * 0.8 + t * 0.1)) + t * 0.05;   // <- soften this term
q = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * q;
vec2 g = q * 22.0, id = floor(g), fp = fract(g) - 0.5;
float field = noise(id * 0.13 + t * 0.08);
float d = length(fp) - (0.12 + 0.36 * field);
```

### 2. `voronoi-shatter` — "Voronoi Shatter" — Abstract — **prototyped, strong**

A slowly breathing Voronoi mosaic: each cell jitters around its site, the two nearest-site
distances give an F2−F1 edge field, and those edges glow like lit fissures between plates.
Per-cell hash tints each plate slightly differently so the surface reads as a fractured
mineral sheet rather than a diagram. This is the collection's missing cellular tessellation
and it is the strongest render of the four.

Prototype is a 3×3 neighbour scan (9 iterations, constant bounds — ES 1.00 legal) and is
cheap. Watch the `hash2` sin-fract precision: at high `cellScale` the classic
`fract(sin(dot(...)) * 43758.5453)` can band on some drivers, so the port should use the
collection's existing hash helper if one exists, otherwise a multiply-xor variant.

Controls: `speed` (Motion), `cellScale`, `crackWidth`, `plateVariation` (Shape),
`drift` (Motion), `crackColor` (primary), `plateColor` (secondary), `background` (surface),
`brightness`, `saturation` (Color).

Core of the prototype:

```glsl
float d1 = 8.0, d2 = 8.0; vec2 cellId = vec2(0.0);
for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
  vec2 g = vec2(float(i), float(j));
  vec2 o = 0.5 + 0.45 * sin(t + 6.2831 * hash2(ip + g));
  vec2 r = g + o - fp;
  float d = dot(r, r);
  if (d < d1) { d2 = d1; d1 = d; cellId = ip + g; } else if (d < d2) { d2 = d; }
}
float crack = 1.0 - smoothstep(0.0, 0.10, sqrt(d2) - sqrt(d1));
```

### 3. `moire-lattice` — "Moiré Lattice" — Abstract — **prototyped, needs a polish pass**

Three near-aligned fine grids: each pair beats against the others, so broad dark/light
bands sweep across a fine mesh as the angle spread slowly opens and closes. Prototype v1
(three grids at ~120° apart) failed — it produced a flat uniform mesh with no beat. v2/v3
with a **small** angle spread (`0.045 ± 0.02 rad`) produced the intended broad moiré bands.

Polish needed before porting:
- At 512 px the finest grid sits close to Nyquist and shimmers under motion. Cap
  `gridFrequency` so the finest period stays above ~3 px at 1080p, and/or widen
  `lineWidth` slightly.
- Add a vignette / radial falloff; the current field is edge-to-edge uniform.
- The three-phase beat reads a little flat — grade the beat through two inks plus a
  highlight instead of a single ramp.

Controls: `speed` (Motion), `gridFrequency`, `lineWidth`, `phaseOffset` (Shape),
`angleSpread` (Shape), `spreadPeriod` (Motion), `ink` (primary), `highlight` (tertiary),
`background` (surface), `brightness`, `saturation` (Color).

### 4. `attractor-silk` — "Attractor Silk" — Abstract — **prototyped, medium risk**

Density-splatted strange attractor: iterate the map, splat each sample as a Gaussian,
tone-map the accumulation. Two maps selectable: **Thomas** (`p += dt*(sin(y)-0.19x, …)`, a
cyclically symmetric 3-lobed ribbon) and **Clifford** (`sin(a·y)+c·cos(a·x)`, a chaotic
dust). This is the only *iterated dynamical system* in the collection and it looks unlike
anything else here.

Rendered results, and the honest caveats:
- Thomas renders as a beautiful luminous three-lobed ribbon **but as a thin curve, not a
  dense tangle**, and it framed off-centre/low.
- Clifford renders as a proper chaotic dust cloud **but at low contrast and also
  off-centre**.
- First attempts failed outright (near-black frames) from a too-short warm-up
  (`dt·steps` too small, transit still in the frame) and a too-tight splat
  (`exp(-d²·2600)` with only ~400 samples). Working settings: **warm-up ≥ 300 steps,
  800–2000 splat samples, splat width `exp(-d²·900…1800)`, gain ≈ 0.05–0.12**.
- **Centre and frame the attractor from data, not by eye**: pre-compute (on paper) the
  orbit's bounding box for the chosen parameters and map it into the short-edge
  normalized space. Both prototypes were visibly off-centre.
- **Perf**: 2000 iterations per pixel is the most expensive candidate here. GLSL ES 1.00
  needs constant loop bounds, so implement as `for (i = 0; i < 2000; i++) { if (float(i) >= samples) break; }`, and keep the default sample count near 800 pending a `check-shaders`
  readback-timing measurement.

Controls: `speed` (Motion), `map` (select: `thomas`/`clifford`) *(Shape)*,
`orbitSamples` (int), `splatSize`, `zoom`, `tilt` (Shape), `rotation` (Motion),
`color1` (primary), `color2` (secondary), `background` (surface), `brightness`,
`saturation` (Color).

### 5. `kaleido-strata` — "Kaleido Strata" — Abstract — **prototyped, optional**

Angular-fold kaleidoscope over a banded field; rendered as a clean 12-fold rosette with a
warm/cool core. It **works and is cheap**, but it reads generic — the collection has no
kaleidoscope, yet it also has 11 ring-based shaders, so the novelty is thinner than the
other four. Recommend holding it as the stretch item rather than shipping it to pad the
batch.

## Phases

### Phase 1 — `halftone-bloom`

1. Fix the rotation-seam flaw in shadereye; re-render and `diff_shaders` against the
   current prototype to confirm only the seams changed.
2. Write `src/renderer/shaders/halftone-bloom/{manifest.ts,shader.glsl}` in the scrnsvr
   contract (`precision highp float;`, `gl_FragColor`, `float t = uTime * speed;`, standard
   brightness → saturation → static-dither tail).
3. Register in `tests/shader-manifests.test.ts` (import + `manifests` array entry) and add a
   row to `docs/shader-parameters.md`.
4. `npm run typecheck && npm test`, then `SCRNSVR_SHADER_FILTER=halftone-bloom npm run check-shaders`.

⏸️ **Checkpoint:** report the seam-fix render plus the `check-shaders` output before Phase 2.

### Phase 2 — `voronoi-shatter`

1. Port, register, document.
2. Confirm `cellScale` endpoints (min and max) do not push the 3×3 scan past its neighbour
   window (a too-large scale with too-small cells makes the crack field alias).
3. Full verification chain.

⏸️ **Checkpoint:** confirm the crack field reads at both `cellScale` endpoints.

### Phase 3 — `moire-lattice`

1. Do the polish pass in shadereye: Nyquist cap, vignette, two-ink grading. Use
   `render_animation` across a `spreadPeriod` half-cycle to check the beat never stalls.
2. Port, register, document, full verification chain.
3. Explicitly check the `lineWidth` min endpoint and `gridFrequency` max endpoint at
   `uTime = 86400` — this shader has the highest aliasing risk of the batch.

⏸️ **Checkpoint:** show the animation filmstrip and confirm no shimmer strobe at the
`gridFrequency` max.

### Phase 4 — `attractor-silk` (riskiest, deliberately last)

1. Fix framing: derive the orbit bounding box, centre and scale from it.
2. Tune Thomas vs Clifford to comparable quality; decide whether `map` ships as a select
   or whether only the better one ships.
3. Implement the sample loop with a constant bound + `break`; set the default near 800.
4. Port, register, document, full verification chain. **Read the `check-shaders` readback
   timing** and lower `orbitSamples` default if it is out of line with the collection.
5. Verify `splatSize` and `zoom` min endpoints do not divide by zero or produce a fully
   saturated (clipped) frame.

⏸️ **Checkpoint:** show timing + both maps side by side; drop the weaker map if time-boxed.

### Phase 5 — optional, only if asked

- `kaleido-strata` as described above.
- Batch 1 stays a separate workstream; do not mix its four shaders into this batch.

## Verification (every shader in the batch)

```sh
npm run typecheck          # regenerates src/renderer/shaders/generated.ts, then tsc
npm test                   # manifest contracts, ranges, randomization, uniform decls
npm run check-shaders      # real Chromium: WebGL 1 + WebGL 2, all hard rules
npm start -- --preview --shader <id>
```

Per-shader contract checklist:

- [ ] Folder name == `manifest.id`; one manifest export, first in the file; two files only.
- [ ] GLSL ES 1.00, `precision highp float;` first, writes `gl_FragColor`; no textures, no
      passes, no dynamic loop bounds.
- [ ] Every declared uniform referenced in `main()` and visibly changing output.
- [ ] All animation via `uTime * speed`; `speed: 0` byte-identical; `speed` multiplies time
      and nothing else.
- [ ] `saturation: 0` exactly grayscale (scalar, static fragcoord dither only).
- [ ] Numeric `min`/`max` endpoints render without GL error at `uTime = 86400`.
- [ ] `speed` (Motion, min 0), `brightness`, `saturation` (min 0, max ≥ 2) present;
      ≥ 3 groups used; every uniform labelled, described, grouped.
- [ ] Every `color` uniform has an explicit `colorRole`; backgrounds `random: false`.
- [ ] Short-edge normalization — must read in portrait 360×640 and ultrawide 960×270, both
      tested by the harness. `halftone-bloom` (dot aspect) and `moire-lattice` (fine
      lines under non-uniform scale) are the likeliest to need a nudge.
- [ ] `uDate` / `uAudio` **not** declared — none of these are clock or reactive shaders.
- [ ] If a `select` uniform is used (`attractor-silk`), `visibleWhen` values elsewhere must
      match the parent's type exactly.

Note on aspect normalisation: both styles are legal in this repo — 19/53 shaders use the
runtime-provided `varying vec2 vUv`, the rest normalise `gl_FragCoord` against
`uResolution`. Pick one per shader and stay consistent with it.

## Risks

- **shadereye is look-dev, not a gate.** Every rule in the checklist is enforced only by
  `check-shaders`. A shader that renders beautifully in shadereye can still fail on the
  `speed == 0` freeze, the grayscale check, or an unused-uniform drop. Budget for the port.
- **`attractor-silk` is the schedule risk**: framing, density and perf all needed work in
  the prototype, unlike the other three which rendered well on the second pass.
- **`moire-lattice` aliasing** is the second risk: fine grids near Nyquist both shimmer and
  can fail the "visibly changes output" check if the beat happens to sit on a flat phase at
  an endpoint. Cap frequency, add a vignette.
- **Halftone rotation seams** are a known, already-localised defect — cheap to fix, but if
  the fix changes the dot lattice globally, re-diff.
- **Identity risk**: if all four ship, the batch is four high-frequency patterned shaders.
  If the set starts to feel homogenous, ship the two strongest — `halftone-bloom` and
  `voronoi-shatter` — and stop. Quality over quota.
- **Duplication risk with batch 1** is nil by id, but both batches touch
  `tests/shader-manifests.test.ts` and `docs/shader-parameters.md`; whichever lands second
  rebases its edits.

## Out of scope

- No changes to existing shader ids, manifests, palettes, or saved-look compatibility.
- No hand-editing of `src/renderer/shaders/generated.ts` (it is generated).
- No new dependencies; no textures, no multipass, no engine uniform additions.
- No clock (`uDate`) or reactive (`uAudio`) shaders in this batch.
- `impeccable` / DESIGN.md work is untouched: these shaders do not change the settings shell.
- Leitfaden MCP is not exposed in this session, so no project-management records are
  created; this file is the plan of record.