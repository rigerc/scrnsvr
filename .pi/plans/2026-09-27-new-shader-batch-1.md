---
title: "New shader batch: Umbra Dial, Loom Weave, Day Arc, Spectral Bloom"
status: draft
created: "2026-09-27T19:31:05.350Z"
type: feature
---

# New shader batch — 4 additions

Date: 2026-09-27. **Planning only — no repo files changed yet.** This plan is additive:
it does **not** touch existing shader ids, saved looks, manifests, or the
`docs/shader-improvement-plan.md` workstream (which edits *existing* shaders' controls).

## Objective

Add original built-in shaders that fill real gaps in the collection and add new
*material families* rather than a 16th soft gradient.

## Evidence: where the collection is thin

Registry = 53 shaders. Category counts from `src/renderer/shaders/*/manifest.ts`:

| Category | Count | Notes |
|---|---|---|
| Abstract | 15 | saturated |
| Ambient | 10 | saturated |
| Landscapes | 6 | |
| Water | 6 | |
| Digital | 5 | |
| Space | 5 | |
| **Clocks** | **3** | `avs-glow-clock`, `avs-green-clock`, `avs-seven-segment` — **2 are AVS imports, and there is no analog face at all** |
| **Reactive** | **3** | all three come from the same `reactiveManifest()` factory and are all radially-pulsed (`pulse-rings`, `bass-bloom`, `audio-ribbons`) |

Two concrete gaps: **Clocks** (3, weakest category, and the app is a *clock-capable*
screensaver with a whole `uDate` uniform contract) and **Reactive** (3, single-shape
family). A third gap is *material*: there is no fabric/textile/weave shader anywhere —
the closest are `liquid-chrome` (metal), `opal-film` (thin film), `prism-mosaic` (glass).

## shadereye tool constraints discovered during prototyping

These shape the workflow and are worth recording:

1. **shadereye's renderer accepts Shadertoy dialect only** — `mainImage(out vec4, in vec2)`,
   `iTime`, `iResolution`. That dialect compiles and renders fine.
2. **It hangs (request timeout) on plain GLSL ES 1.00** using `gl_FragColor` + `uTime` +
   `uResolution`. Confirmed twice. So scrnsvr sources cannot be pasted in directly.
3. **`iDate` is unsupported and also hangs** (confirmed with a 2-line shader). Therefore
   **clock shaders cannot be validated in shadereye**; prototype with the time frozen as
   a constant (`float secs = 3.0*3600.0 + 26.0*60.0 + 42.0;`) and verify the real `uDate`
   path in-repo.
4. **`validate_shader` is not an ES 1.00 gate.** It parses as GLSL/SPIR-V 450 semantics and
   rejects bare `uniform` declarations and `gl_FragColor`. Use it only on Shadertoy-dialect
   prototypes, not as the contract check.
5. **`run_in_browser` (headless Chromium WebGL2) timed out** in this environment. The
   authoritative WebGL 1 **and** 2 check is the repo's own
   `npm run check-shaders` (real Chromium via Electron), which already asserts the
   unused-uniform, visible-difference, `speed == 0` freeze, and grayscale rules.
6. `render_shader`, `render_animation` (filmstrip), `probe_pixels`, and `diff_shaders`
   all work and are the fast iteration loop.

**Workflow per shader:** prototype in Shadertoy dialect → iterate with
`render_shader` / `render_animation` / `diff_shaders` → port to the scrnsvr contract
(`precision highp float;`, `uniform float uTime; uniform vec2 uResolution;`, `gl_FragColor`,
`float t = uTime * speed;`, standard brightness/saturation/static-dither tail) → verify
in-repo.
## Proposed shaders

### 1. `umbra-dial` — "Umbra Dial" — Clocks — **prototyped, looks good**

Analog face. Luminous tapered hands with a soft offset *umbra* (a second, dimmer hand
copy displaced down-right) so the hands read as floating above the plate. 60 constant-width
perpendicular-distance ticks (longer at hours), 12 hour pips, thin rim, slow angular sheen,
warm centre cap. Uses `uDate.w`.

Controls: `speed` (Motion), `dialScale`, `handLength`, `handWidth`, `tickEmphasis`,
`umbraStrength`, `umbraOffset` (Shape), `sheenRate` (Motion), `handColor` (primary),
`dialColor` (surface), `background` (surface), `brightness`, `saturation` (Color).

Prototype lessons already applied: ticks must be **banded** (`smoothstep(0.74,0.80,r) *
smoothstep(0.905,0.855,r)`) or they render as full radial spikes; tick width must use
**perpendicular distance** `abs(dot(m, vec2(-sin(a), cos(a))))`, not `da * r`.

### 2. `loom-weave` — "Loom Weave" — Abstract — **prototyped (v2), needs one polish pass**

Plain-weave textile. Per cell, warp or weft is on top (`mod(i+j,2)`), threads are wider
than the cell so they overlap, cylindrical cross-section shading from an upper-left light,
cast shadow at the edges of the top thread, low-frequency drape warp so the cloth is not a
plane, per-thread brightness variation, vignette. v2 render reads clearly as woven fabric;
still slightly basket-like and high-contrast — needs softer thread edges and a gentler
per-cell variation.

Controls: `speed` (Motion), `threadDensity`, `threadWidth`, `drapeAmount`, `weaveBias`
(Shape), `sheen`, `contrast`-like `threadShading` (Color), `warpColor` (primary),
`weftColor` (secondary), `background` (surface), `brightness`, `saturation`.

### 3. `day-arc` — "Day Arc" — Clocks — to prototype

A **spatial** day clock, complementary to the analog face and the existing digit clocks:
a sun/moon disc travels a fixed arc; the disc's position along the arc is the time of day,
and the sky gradient is keyed to the real hour (pre-dawn → dawn → noon → dusk → night) so
the shader is a slow, ambient read of the day. Uses `uDate.w`. Must stay readable and calm
at 1 fps; motion besides the disc is driven by `uTime * speed`.

Controls: `speed` (Motion), `arcHeight`, `discSize`, `horizonHeight`, `starDensity` (Shape),
`twilightWarmth` (Color), `sunColor` (primary), `skyTop` (tertiary), `background` (surface),
`brightness`, `saturation`. Include `showSeconds` (`bool`) for the disc's interpolation.

### 4. `reactive-spectral-bloom` — "Spectral Bloom" — Reactive — to prototype

Deliberately **not radial**. `uAudio` bands drive a stack of horizontal spectral ribbons that
bloom and shear along a flow axis, so the reactive family gains a second silhouette. Built on
`reactiveManifest()` from `src/renderer/reactive-manifest.ts` (gives `speed`, `sensitivity`,
`audioLight`, `audioShape`, `shapeDetail`, `scale`, `brightness`, `color1`, `color2`,
`background`, `saturation`). Audio must persist at `speed: 0` and vanish exactly at
`sensitivity: 0`.

**Caveat:** shadereye cannot preview audio (no `iChannel`). This one is verified purely by
`npm run check-reactive-audio`.

## Phases

### Phase 1 — `umbra-dial` (lowest risk, already validated)

1. Write `src/renderer/shaders/umbra-dial/{manifest.ts,shader.glsl}` in the scrnsvr contract.
2. Add to the `manifests` array in `tests/shader-manifests.test.ts`.
3. Add a row to the table in `docs/shader-parameters.md`.
4. Replace the hardcoded `secs` with `uDate.w`; confirm `uDate` is declared and used.
5. `npm run typecheck && npm test`.
6. `SCRNSVR_SHADER_FILTER=umbra-dial npm run check-shaders`.
7. Eyeball: `npm start -- --preview --shader umbra-dial`.

⏸️ **Checkpoint:** report the check-shaders output + preview before Phase 2.

### Phase 2 — `loom-weave`

1. Polish pass in shadereye (softer thread edges, lower per-cell variance, stronger drape);
   re-render and compare with `diff_shaders`.
2. Port to the contract, register in the test array and docs table.
3. Same verification chain as Phase 1.

⏸️ **Checkpoint:** show the polished render before porting.

### Phase 3 — `day-arc`

1. Prototype in shadereye with frozen `secs`; iterate until the arc reads at a glance.
2. Port, declare `uDate`, wire `showSeconds` as a `bool` uniform.
3. Register + docs + full verification chain. Verify the `showSeconds` boolean
   `visibleWhen`/`random` typing carefully (the existing plan documents a real bug class here:
   `visibleWhen` on a `bool` parent must carry a boolean, never a number).

⏸️ **Checkpoint:** approve the day/night colour ramp before porting.

### Phase 4 — `reactive-spectral-bloom`

1. Build on `reactiveManifest(...)`; do not hand-roll the standard reactive controls.
2. Verify with `npm run check-reactive-audio` (delta between silence and loud must sit in the
   required band, persist at `speed: 0`, and be exactly zero at `sensitivity: 0`).
3. Register + docs + `check-shaders`.

⏸️ **Checkpoint:** confirm the audio response is restrained, not a strobe.

### Phase 5 — optional stretch (only if asked)

- `mineral-strata` (Landscapes): layered geological cross-section with banded refraction —
  no strata/mineral shader exists.
- `halftone-bloom` (Abstract): screen-print dot lattice — the collection has no
  print/graphic shader.

## Verification (applies to every shader in the batch)

```sh
npm run typecheck          # regenerates the shader registry, then tsc
npm test                   # manifest contracts, ranges, randomization, uniform decls
npm run check-shaders      # real Chromium: WebGL1 + WebGL2, all hard rules
npm start -- --preview --shader <id>
```

Per-shader contract checklist:

- [ ] Folder name == `manifest.id`; one manifest export, first in the file; two files only.
- [ ] GLSL ES 1.00, `precision highp float;` first, writes `gl_FragColor`; no textures,
      no passes, no dynamic loop bounds or dynamic array indexing.
- [ ] Every declared uniform referenced in `main()` and visibly changing output.
- [ ] All animation via `uTime * speed`; `speed: 0` byte-identical; `speed` multiplies
      time and nothing else.
- [ ] `saturation: 0` exactly grayscale (scalar, static fragcoord dither only).
- [ ] Numeric `min`/`max` endpoints render without GL error at `uTime = 86400`.
- [ ] `speed` (Motion, min 0), `brightness`, `saturation` (min 0, max >= 2) present;
      >= 3 groups used; every uniform labelled, described, grouped.
- [ ] Every `color` uniform has an explicit `colorRole`; backgrounds `random: false`.
- [ ] Short-edge aspect normalization `min(uResolution.x, uResolution.y)` — must read in
      portrait 360x640 and ultrawide 960x270, both of which the harness tests.
- [ ] `uDate` declared only in clock shaders; `uAudio` only in the reactive shader.

## Risks

- **shadereye is a look-dev tool, not a gate.** Every hard rule above is enforced only by
  the repo harness. A shader that renders beautifully in shadereye can still fail on the
  `speed == 0` freeze, the grayscale check, or an unused-uniform drop. The port is the real
  work; budget for it.
- **Clock shaders are unverifiable in shadereye** (`iDate` hangs) — the first `uDate` render
  happens in `check-shaders`. Phase 1 is ordered first partly to de-risk this early.
- **Reactive is audio-blind in shadereye** — iterate on shape with a synthetic band signal
  baked in as constants, then hand it to `check-reactive-audio`.
- **Portrait framing** is a covered test case but easy to get wrong; `umbra-dial` and
  `day-arc` are the most likely to need a portrait-specific nudge.
- **Perf**: `umbra-dial` and `loom-weave` are per-pixel analytic and cheap; `day-arc` needs
  a bounded star loop. `check-shaders` reports readback timing — watch it.

## Out of scope

- No changes to existing shader ids, manifests, palettes, or saved-look compatibility.
- No hand-editing of `src/renderer/shaders/generated.ts` (it is generated).
- No new dependencies; no textures, no multipass; no engine uniform additions.
- The `docs/shader-improvement-plan.md` control/colour workstream stays separate.
- Leitfaden MCP is not exposed in this session, so no project-management records are created;
  this file is the plan of record.
