---
title: "Add color options to 13 imported shaders (Tier A + B)"
status: draft
created: "2026-09-26T17:42:02.007Z"
type: feature
---

# Add color options to 13 imported shaders (Tier A + B)

## Goal

Give 13 of the 28 imported (AVS / ShaderSaver) shaders real `type: 'color'` controls that
plug into the existing global/per-shader color-scheme system, **without changing each
shader's default appearance**. The other 15 imports stay untouched: 8 have no stable
palette to lift (intrinsic hue cycling) and 7 are lower-value variants.

## Why this is cheap

`applyColorRoles()` in `src/shared/palettes.ts` already maps uniform names to ANSI roles:

```
color/color1/midtone → primary      color2 → secondary
color3/highlight     → tertiary     background/shadow → surface
```

Any manifest exposing `type: 'color'` becomes scheme-aware with **zero new plumbing**;
`hasColorUniforms()` starts returning true and `schemeIdForShader()` begins applying.
Colours are converted as plain `/255` — no sRGB→linear — in
`src/renderer/core/runtime.ts` (`oglValue()`) and identically in `scripts/check-shaders.cjs`.
So a hex default maps 1:1 to the existing `vec3` constants.

## Hard constraints (discovered)

1. `scripts/check-shaders.cjs:78` asserts **every declared uniform has a non-null GL
   location**. Every added uniform must genuinely be read by the fragment shader.
2. `tests/shader-manifests.test.ts` requires per-uniform `label`, `description`,
   `group` ∈ {Motion, Shape, Color}, a matching `uniform vec3 <name>;` line, and valid
   defaults. The 13 changed manifests must be added to its `manifests` array.
3. `tests/imported-shaders.test.ts` requires the leading `// Ported from AVS|ShaderSaver`
   comment and retention of `speed`, `contrast`, `brightness`, `saturation`.
4. **Name collisions.** Prefer `color1` / `color2` / `color3` / `background`. Never use
   `color` — most targets already declare a local `vec3 color`. Never use `background`
   in `shadersaver-water-ripples` (it defines `vec3 background(vec3 d)`).
5. Constants above 1.0 cannot be hex. Fold the excess into the existing multiplier
   (`clouds` ×1.1, `water-ripples` ×1.08, `alien-waterworld` suns ×0.5/×8, `sea` ×0.6).
6. `import-upstream-shaders.mjs` is **manual-only** and is not invoked by
   `scripts/build.mjs`, so hand edits to `manifest.ts` / `shader.glsl` survive
   `npm run build` and `npm run typecheck`.
7. `randomizeUniforms()` assigns random hex to any colour not marked `random: false`
   (`src/renderer/core/uniforms.ts:39,53`). Mark every `background` uniform
   `random: false`, matching the `reactive-*` convention.

## Phase 1 — Tier A: single hardcoded tint (6 shaders)

Highest value / lowest risk. Each replaces a literal `vec3` (or a `bool` switch) with one
or two uniforms.

| # | Shader | Site | Current value | Uniform(s) | Default hex |
|---|---|---|---|---|---|
| 1 | `avs-ocean` | `shader.glsl:63` | `tanhCol = vec3(0.0, tanhCol.g, 0.0);` | `color1` | `#00ff00` |
| 2 | `avs-green-clock` | `shader.glsl:240,242` | `vec3(0.2,0.8,0.2)` / `vec3(0,1,0.2)` | `color1` / `color2` | `#33cc33` / `#00ff33` |
| 3 | `avs-glow-clock` | `shader.glsl:245,247` | `vec3(1,0.2,0)` ×2 | `color1` | `#ff3300` |
| 4 | `avs-matrix` | `shader.glsl:210` | `vec3(0.67,1.0,0.82)` / `vec3(0.25,0.80,0.40)` | `color1` / `color2` | `#abffd1` / `#40cc66` |
| 5 | `avs-seven-segment` | `shader.glsl:92,145-159` | `bool isGreen` branches | `color1` / `color2` | `#00ff00` / `#00ccff` |
| 6 | `shadersaver-water-ripples` | `shader.glsl:100` | `vec3(0.72,0.9,1.08)` | `color1` | `#b8e6ff` |

Notes:

- **`avs-ocean` is effectively a bug fix.** It currently forces every pixel onto the green
  channel, discarding the full RGB spectrum it computes. `tanhCol = color1 * tanhCol.g;`
  reproduces `#00ff00` exactly and unlocks the colour that is already being calculated.
- `avs-seven-segment` is the one judgment call (see Risks). Its branches encode
  *inconsistent* per-mode channel mixes: matrix mode uses `(0,1,0.5)`/`(0,0.8,1)`,
  segment mode uses `(0,1,0)`/`(1,0,0)`. Plan: render lit segments as `color1 * vec3(1,1,0.5)`
  in matrix mode and `color1` in segment mode, so the default path (segment mode) matches
  byte-for-byte and matrix mode normalises to a sane per-channel multiply.
- `shadersaver-water-ripples` keeps `* vec3(1.0, 1.0, 1.08)` after `color1` so the 8 %
  blue overdrive is preserved exactly.

## Phase 2 — Tier B: small palettes (7 shaders)

Reduce each shader's constant set to 3–4 role-mapped uniforms and derive the remaining
shades from them, preserving the original channel ratios.

| # | Shader | Uniforms (role) | Default hex | Derived from originals |
|---|---|---|---|---|
| 7 | `avs-terrain` | `color1` (drySand), `color2` (redEarth), `color3` (rock), `background` (skyLow) | `#382e1f`, `#2e1a0f`, `#1a1412`, `#66b3ff` | `paleSand = color1*1.25`; `darkRock = color1*0.28`; `skyHigh = background*vec3(0.5,0.571,0.6)` |
| 8 | `avs-clouds` | `background` (skycolour1), `color1` (skycolour2), `color2` (cloud) | `#336699`, `#66b3ff`, `#ffffd1` | cloud keeps `* 1.1` fold at `shader.glsl:123` |
| 9 | `avs-sea` | `background` (SEA_BASE), `color1` (SEA_WATER_COLOR) | `#00172e`, `#cce699` | keep `* 0.6` fold at `shader.glsl:39-40` |
| 10 | `avs-stardust` | `color1` (orange), `color2` (blue) | `#ffb366`, `#66b3ff` | — |
| 11 | `avs-alien-waterworld` | `background` (skyCol1), `color1` (sun), `color2` (small sun), `color3` (ring) | `#597399`, `#ffe6cc`, `#ff8040`, `#f2a673` | `skyCol2 = background³ × 3`; ring keeps `sqrt(color3)`; suns keep `×0.5 / ×8` |
| 12 | `avs-field` | `color1` (sunColour), `color2` (foliage), `background` (sky) | `#ffbf99`, `#004c00`, `#1a334d` | foliage/grass at `shader.glsl:205` |
| 13 | `avs-seascape` | `color1` (material), `color2` (light), `color3` (sun), `background` (fog) | `#262626`, `#ffffff`, `#ffcc99`, `#8099b3` | light keeps its `(2.0,1.5,1.0)` scale fold; fog at `shader.glsl:189`, sun at `:193-194` |

Decline `avs-alien-waterworld`'s `planetCol` if 4 uniforms already feel heavy; it is the
only genuinely independent 5th role and can stay a constant.

## Phase 3 — Wiring, tests, docs

- Add the 13 manifests to the `manifests` array in `tests/shader-manifests.test.ts` so the
  strict uniform contract validates the new controls (this is currently the only place the
  imported manifests are *not* covered).
- Extend `tests/palettes.test.ts` with a case asserting each of the 13 now reports
  `hasColorUniforms() === true` and receives scheme values, and that
  `clearShaderColorOverrides()` removes them.
- Update `docs/shader-parameters.md`:
  - add a row per shader to the "Additional adjustments" table listing the new colour roles;
  - amend the sentence *"The shaders without color controls keep their built-in palettes."*
    to name the remaining 15 explicitly.
- `scripts/check-shaders.cjs` already loops `['#000000','#ffffff']` over every colour
  uniform, so the extreme-value coverage is automatic.

## Verification

Run in order, on a desktop session or under Xvfb:

1. `npm run typecheck` — registry + palettes + tsc.
2. `npm test` — manifest contracts, palettes, imported-shader provenance.
3. `npm run check-shaders` — Electron/software-WebGL: unused-uniform assertion,
   parameter extremes, grayscale + paused, aspect ratios, 1080p readback.
4. Manual spot-check with `npm run settings`:
   - default render of each of the 13 is visually unchanged from `main`;
   - setting a global scheme (e.g. Nord) visibly recolors all 13;
   - a per-shader override wins over the global scheme;
   - Noctalia import recolors all 13;
   - Randomize preserves each `background` value (`random: false`).

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `avs-seven-segment` cannot preserve both matrix and segment modes exactly | Preserve the default (segment) path byte-for-byte; normalise matrix mode to `color1 * vec3(1,1,0.5)`. Confirm the default `showMatrix` value before editing. |
| Reducing 5–7 constants to 3–4 changes intermediate blends | Derive shades with the original channel ratios, then diff a rendered frame against `main` at default settings. Accept small drift only where a role is genuinely cosmetic. |
| Added uniform is declared but never read → `check-shaders` failure | Every uniform in the tables above replaces a live constant or branch; verify with a full `npm run check-shaders` pass. |
| Uniform name shadowed by a local | Names restricted to `color1/2/3` + `background`; `background` explicitly excluded for `shadersaver-water-ripples`. |
| Colour scheme surprises on imported shaders | `random: false` on all `background` uniforms; colour defaults are the exact existing values, so `scheme: 'none'` is a no-op. |

## Rollback

All changes are additive to per-shader `manifest.ts` / `shader.glsl` files plus a docs
table. Reverting the 13 shader folders and the docs section restores current behaviour;
no shared runtime code is modified.
