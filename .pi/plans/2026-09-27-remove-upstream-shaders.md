---
title: "Remove upstream (AVS + ShaderSaver) shaders"
status: done
created: "2026-09-27T21:03:29.483Z"
type: refactor
---

# Remove upstream (AVS + ShaderSaver) shaders

## Goal

Delete every vendored upstream effect port from scrnsvr — 18 AVS ports and 10 ShaderSaver
ports — together with the toolchain that generated them, and leave the 25 native effects as
the complete built-in set (53 → 25 shaders).

Decisions already made:

- **Scope:** AVS + ShaderSaver ports only. `docs/refs/` (Atelier reference material),
  `reference/*.yml` (Ghostty/iTerm2 palette sources), and the LYGIA simplex-noise code inlined
  in `opal-film` / `ink-bloom` all stay.
- **Toolchain:** delete it (import script, both adapter libs, both unit-test suites).
- **Old configs:** no migration. Unknown shader ids keep falling back through the existing
  renderer path; dead rotation/preset entries are tolerated as-is.

**Baseline: commit `aa2815e`** ("make mainImage + fragCoord the canonical shader ABI"). All
counts, couplings and file references below were re-verified against that commit. `aa2815e`
is the migration that folded the palette/post pipeline into every `shader.glsl` and added
`src/shared/shader-source.ts`, `scripts/lib/canonical-shader.mjs`,
`tests/canonical-shader.test.ts` and `tests/shader-source.test.ts`. It also removed the
then-untracked scratch scripts `migrate-shaders-to-mainimage.mjs` and `.dryrun.mjs`; earlier
drafts of this plan referenced both — they no longer exist and need no work.

## Shader inventory

### Removed — 28 shaders (56 files: `manifest.ts` + `shader.glsl` each)

AVS — 18 (`src/renderer/shaders/avs-*`):

| id | source |
|---|---|
| `avs-seven-segment` | `7seg.glsl` |
| `avs-alien-waterworld` | `alienwater.glsl` |
| `avs-clouds` | `cloud.glsl` |
| `avs-field` | `field.glsl` |
| `avs-fractal` | `fractal.glsl` |
| `avs-galaxy` | `galaxy.glsl` |
| `avs-glow-clock` | `glowclock.glsl` |
| `avs-green-clock` | `greenclock.glsl` |
| `avs-matrix` | `matrix.glsl` |
| `avs-ocean` | `ocean.glsl` |
| `avs-ripple` | `ripple.glsl` |
| `avs-sea` | `sea.glsl` |
| `avs-seascape` | `seascape.glsl` |
| `avs-sinus` | `sinus.glsl` |
| `avs-stardust` | `stardust.glsl` |
| `avs-terrain` | `terrain.glsl` |
| `avs-tunnel-wisp` | `tunnelwisp.glsl` |
| `avs-waves` | `waves.glsl` |

ShaderSaver — 10 (`src/renderer/shaders/shadersaver-*`):

| id | source |
|---|---|
| `shadersaver-singularity` | `shader.txt` |
| `shadersaver-sunset` | `shader2.txt` |
| `shadersaver-starship` | `shader3.txt` |
| `shadersaver-origami` | `shader4.txt` |
| `shadersaver-shield` | `shader5.txt` |
| `shadersaver-ghosts` | `shader6.txt` |
| `shadersaver-waveform` | `shader7.txt` |
| `shadersaver-water-ripples` | `shader8.txt` |
| `shadersaver-simplex` | `shader9.txt` |
| `shadersaver-rainbow-road` | `shader13.txt` |

Every one of these carries a `// Ported from (AVS|ShaderSaver)/…` header and the four
imported controls (`speed`/`contrast`/`brightness`/`saturation`) plus an `original|custom`
`palette` select with three tonal colors. That signature is the check used in verification.

### Left — 25 native shaders

`src/renderer/shaders/` keeps exactly:

`aurora-veil`, `contour-dunes`, `ember-drift`, `flow-field`, `gradient-blobs`,
`gradient-drift`, `guilloche`, `ink-bloom`, `interference`, `kinetic-tiles`,
`liquid-chrome`, `magnetic-filaments`, `mesh-gradient`, `opal-film`, `paper-lanterns`,
`phosphor-garden`, `plasma`, `prism-mosaic`, `rain-glass`, `reactive-audio-ribbons`,
`reactive-bass-bloom`, `reactive-pulse-rings`, `silk-ribbons`, `star-drift`,
`tidal-caustics` — plus the two generated modules `generated.ts` and `index.ts`.

Surviving catalogue shape:

- Categories still populated: `Ambient` (8), `Abstract` (9), `Landscapes` (1),
  `Space` (1), `Water` (2), `Digital` (1), `Custom` (user shaders).
- `Clocks` becomes empty (its only three members were AVS clocks). `Reactive` was already
  empty as a manifest category — the three `reactive-*` shaders declare none and fall into
  `Abstract`. Settings skips empty categories (`if (!shaders.length) continue`), so this is
  cosmetic only.
- Featured row (`src/settings/index.ts` `featuredIds`) already lists only native ids; the
  default shader already is `flow-field` (`src/shared/config.ts`).
- No packaged asset mentions an upstream shader: `assets/thumbnails`, `assets/screenshots`,
  `assets/videos` and `assets/plates` contain native ids only.

## Removal surface outside the shader folders

| File | Coupling to upstream shaders |
|---|---|
| `scripts/import-upstream-shaders.mjs` | The 28-entry import table; whole script is upstream-only |
| `scripts/lib/upstream-adapt.mjs` | Adapter pipeline, only consumed by the import script and its test |
| `scripts/lib/upstream-controls.mjs` | Imported controls + `paletteApplication`; consumed by the two above **and** by `canonical-shader.mjs` |
| `scripts/lib/canonical-shader.mjs` | 142 lines. Imports `paletteApplication`; owns `IMPORTED_POST`, `detectUpstreamCompatNames`, `normalizeCompatTokens`, `canonicalSource`, `extractFunction` — **all five are consumed only by `upstream-adapt.mjs`**. Only `glslType` + `fallbackLiteral` have a second consumer: `tests/canonical-shader.test.ts` |
| `tests/canonical-shader.test.ts` | Added by `aa2815e`. Hard-codes `expect(ids.length).toBe(53)` while iterating every shader folder — a guaranteed failure once the 28 are gone |
| `scripts/check-animation-runtime.cjs` | Animates `avs-matrix`; midnight-wrap assertion driven by `avs-seven-segment` |
| `scripts/lib/browser-checks.cjs` | `id === 'shadersaver-waveform'` special case + `assertWaveformSpeckles` |
| `tests/imported-shaders.test.ts` | Asserts 18 + 10 and the ported-shader contract |
| `tests/upstream-adapt.test.ts` | Unit tests for `upstream-adapt.mjs`; rewritten by `aa2815e` to cover the canonical emission path |
| `tests/browser-checks.test.ts` | `shadersaver-waveform` fixture in the fake registry |
| `.fallowrc.json` | Lists `scripts/import-upstream-shaders.mjs` as an entry point |
| `src/renderer/shaders/generated.ts` | Generated; imports all 53 manifests |
| `THIRD_PARTY_SHADERS.md` | AVS, ShaderSaver and Porting-notes sections |
| `README.md` | Lines 29 (53 shaders), 81 (credits link), 126 (import script), 127 (imported contracts test) |
| `docs/shaders.md` (git-tracked) | ~31 hits: one entry per removed shader + the closing "28 of the built-in shaders are browser-compatible ports" paragraph |
| `docs/authoring-shaders.md` (git-tracked) | Line 243 instructs authors to register imports in `THIRD_PARTY_SHADERS.md` and generate via the import script |
| `docs/shader-improvement-plan.md` (git-tracked) | Line 52 mentions upstream notices / double tone mapping |

Historical `.pi/plans/*.md` mention imported shaders. They are point-in-time records — leave them.

## Blast-radius risks

1. **`canonical-shader.mjs` has exactly one upstream coupling and it is load-bearing during
   deletion.** It does `import { paletteApplication } from './upstream-controls.mjs'` and uses
   it inside the exported `IMPORTED_POST`. Nothing else imports `upstream-controls.mjs` after
   `upstream-adapt.mjs` goes, so deleting `upstream-controls.mjs` first leaves a dangling
   import. Resolution: delete `IMPORTED_POST` (and the import) *before or with*
   `upstream-controls.mjs` — no local copy of `paletteApplication` needs to survive, because
   the migrated native shaders already carry their palette mapping inline.
   After that, `detectUpstreamCompatNames`, `normalizeCompatTokens`, `canonicalSource`,
   `extractFunction` and `canonicalUniformBlock`/`ENGINE_FALLBACKS` lose their only caller too
   (`upstream-adapt.mjs`), so `canonical-shader.mjs` reduces to the fallback-literal helpers
   that `tests/canonical-shader.test.ts` needs. `fallow` will flag whatever is left
   unreferenced if any of them is kept.
2. **Loss of clock coverage.** `avs-seven-segment` is the only shader consuming `uDate`; it
   now carries the wrap inline (`mod(uDate.w + uTime * speed, 86400.0)`). No native shader
   uses `uDate`, so after removal `npm run check-animation-runtime` loses its only midnight
   subject and `tests/canonical-shader.test.ts`'s `uDate` assertion becomes vacuous. The
   `custom-clock` synthetic fixture already in that script shows the pattern; the midnight
   assertion needs a synthetic `uDate` fixture to survive, otherwise it is dropped
   deliberately.
3. **`docs/*.md` are deleted in the working tree but present in `HEAD`.** Doc edits must be
   applied to the git-tracked content; if the deletions are intended commit content, the doc
   step shrinks to `README.md` + `THIRD_PARTY_SHADERS.md`. ⏸️
4. **`dist/` is not cleaned by `scripts/build.mjs`** (it only writes + copies), so a stale
   `dist/renderer/shaders/**` or bundled `dist/renderer/index.js` could keep the old registry.
   Verify `dist/renderer/index.js` no longer contains removed ids after a rebuild.
5. **`vitest` coverage thresholds / `fallow` CRAP scores** shift when ~1,100 lines of tested
   script code disappear (`scripts/lib/browser-checks.cjs` keeps its override). Run
   `npm run quality` rather than just `npm test`.

## Phases

### Phase 1 — Delete the upstream shaders and their toolchain

Moves: pure deletions, no logic.

1. Delete `src/renderer/shaders/avs-*/` (18 dirs) and `src/renderer/shaders/shadersaver-*/`
   (10 dirs) — 56 files.
2. Delete `scripts/import-upstream-shaders.mjs`, `scripts/lib/upstream-adapt.mjs`,
   `scripts/lib/upstream-controls.mjs`. **Order matters:** `scripts/lib/canonical-shader.mjs`
   imports `paletteApplication` from `upstream-controls.mjs`, so either delete the two
   adapter libs after Phase 2 drops that import, or delete all three in the same commit.
3. Delete `tests/imported-shaders.test.ts`, `tests/upstream-adapt.test.ts`.

**Verify:** `./src/renderer/shaders` contains 25 shader dirs + `generated.ts` + `index.ts`;
`ls scripts/lib` no longer lists `upstream-*`.

### Phase 2 — Reduce `canonical-shader.mjs` to the survivors

Target state: the module keeps only `glslType`, `fallbackLiteral` and their private helpers
(`GL_TYPE`, `selectIndex`, `formatFloat`, `formatColor`) — the pieces
`tests/canonical-shader.test.ts` imports. Everything upstream-shaped goes.

1. Delete the `import { paletteApplication } from './upstream-controls.mjs';` line (line 12).
2. Delete the now-unreferenced post pipeline and compat machinery:
   - `IMPORTED_POST` (line ~123) and its `export { IMPORTED_POST };` (line ~127);
   - `detectUpstreamCompatNames` (line ~130);
   - `normalizeCompatTokens` (line ~96);
   - `extractFunction` (line ~81);
   - `canonicalSource` (line ~76) and `canonicalUniformBlock` (line ~54) with the private
     `tidy` helper and `ENGINE_FALLBACKS` (the `date` branch only served `uDate`, which no
     remaining shader declares).
   Confirm each has no other caller before removing it — today the only caller of all of them
   is `scripts/lib/upstream-adapt.mjs`, which Phase 1 deletes.
3. Rewrite the module header (lines 1-11). It is **already wrong before this change**: it
   claims the module is used by `scripts/migrate-shaders-to-mainimage.mjs`, which `aa2815e`
   removed, and by `scripts/lib/upstream-adapt.mjs (future imports)`, which this change
   removes. Replace with a one-line statement that it defines the canonical fallback literals
   consumed by `tests/canonical-shader.test.ts`, or delete the module entirely and move
   `glslType`/`fallbackLiteral` into the test if you prefer no build-time helper.
4. No work needed for `scripts/migrate-shaders-to-mainimage.mjs` or `scripts/.dryrun.mjs` —
   both no longer exist.
5. Deletion order recap: `upstream-controls.mjs` must not be deleted while this file still
   imports `paletteApplication` — remove the import here first, or land both in one commit.

**Verify:** `node --check scripts/lib/canonical-shader.mjs`;
`grep -n 'paletteApplication\|IMPORTED_POST\|canonicalizeImported' scripts/lib/canonical-shader.mjs` → empty;
`npx vitest run tests/canonical-shader.test.ts` passes (after the Phase 4 count fix).

### Phase 3 — Repair the check tooling

1. `scripts/check-animation-runtime.cjs`: replace `avs-matrix` in the id loop with a native
   shader that visibly animates (e.g. `plasma`). Remove the `avs-seven-segment`
   resume-exemption (`|| id === 'avs-seven-segment'`).
2. Handle the midnight assertion — pick one:
   - **(a)** add a synthetic canonical-clock fixture built the way the existing `custom-clock`
     fixture is (a hand-written source containing `uDate` and the
     `mod(uDate.w + uTime * speed, 86400.0)` wrap that `avs-seven-segment` carries inline
     today), so the midnight contract stays covered; or
   - **(b)** delete the midnight block and note the coverage loss in the plan/commit message.
   Recommend (a) — it is ~10 lines and keeps the clock-compat contract tested.
3. `scripts/lib/browser-checks.cjs`: delete `assertWaveformSpeckles` (line 110 through its
   closing brace), its `id === 'shadersaver-waveform'` call site in `renderChecks` (line 175),
   and its entry in the module export list (line 327). Leave `renderChecks`, `uiChecks`,
   `assertBaseline`, `browserPrelude` and especially `wrapBuiltinSource` exported —
   `tests/browser-checks.test.ts` and `tests/shader-source.test.ts` both require them.
4. `tests/browser-checks.test.ts`: replace the `shadersaver-waveform` fixture with a native
   id (`plasma`) or a plain synthetic id, and update the `registry` object and the
   `expect(result.reports.map(...)).toEqual([...])` assertion to match.
5. `.fallowrc.json`: remove the `scripts/import-upstream-shaders.mjs` entry from `entry`.

**Verify:** `npm test -- tests/browser-checks.test.ts tests/shader-source.test.ts` passes;
`npm run typecheck` clean.

### Phase 4 — Regenerate the registry, categories and build output

1. Run `node scripts/generate-shader-registry.mjs` → `src/renderer/shaders/generated.ts` holds
   25 imports/properties.
2. `tests/canonical-shader.test.ts` line 36: `expect(ids.length).toBe(53)` → `25`. The rest of
   that suite is folder-driven and self-adjusts, but the hard-coded count fails immediately
   otherwise. Its `uDate`/`uAudio` fallback assertions keep working (they are conditional).
3. Optional cleanup: drop `'Clocks'` from `shaderCategories` in `src/shared/manifest.ts`
   (now empty) and its `ShaderCategory` union member. Purely cosmetic — settings already
   skips empty categories.
4. Rebuild: `npm run build`, then confirm `dist/renderer/index.js` contains no `avs-` or
   `shadersaver-` id and that no stale `dist/renderer/shaders/` copy of a removed shader
   remains (clean `dist/` if `build.mjs` does not).

**Verify:** `grep -c "avs-\|shadersaver-" src/renderer/shaders/generated.ts` → 0;
`find src/renderer/shaders -maxdepth 1 -type d | wc -l` → 26 (25 + `.`);
`npx vitest run tests/canonical-shader.test.ts tests/shader-manifests.test.ts` passes;
`grep -o 'avs-[a-z-]*\|shadersaver-[a-z-]*' dist/renderer/index.js | sort -u` → empty.

### Phase 5 — Documentation

1. `THIRD_PARTY_SHADERS.md`: delete the `## AVS`, `## ShaderSaver` and `## Porting notes`
   sections. Keep the `## LYGIA simplex noise` section (and its MIT text) — still required by
   `opal-film` and `ink-bloom`. Consider renaming the file to `THIRD_PARTY_CODE.md`, or
   keeping the name with a short intro saying it now covers inlined third-party code only.
2. `README.md`: line 29 → "25 GLSL shaders" (drop the AVS/ShaderSaver sentence); line 30's
   "8–17 controls per shader" range must be recomputed from the remaining 25 manifests;
   delete line 81 (imported-credits pointer, or repoint it at the LYGIA-only note); delete
   line 126 (import script) and fix line 127 (drop "imported shader contracts").
3. Git-tracked docs (see risk 3): `docs/shaders.md` — delete the 28 entries and rewrite the
   closing "28 of the built-in shaders are browser-compatible ports…" paragraph.
   `docs/authoring-shaders.md` line 243 — drop the "Imported shaders additionally require…"
   sentence. `docs/shader-improvement-plan.md` line 52 — historical intent, leave or reword.
   ⏸️ Confirm whether these deleted-in-worktree docs are still in scope.

**Verify:** `grep -rni 'avs\|shadersaver' README.md THIRD_PARTY_SHADERS.md docs/ --include='*.md'`
→ only intentional historical hits (`.pi/plans/*`, `docs/shader-improvement-plan.md`) remain.

### Phase 6 — Guard against re-introduction

Optional but recommended, replacing the deleted `tests/imported-shaders.test.ts`:

- New `tests/no-upstream-shaders.test.ts` asserting:
  - no `src/renderer/shaders/{avs,shadersaver}-*` directory exists;
  - no `shader.glsl` under `src/renderer/shaders/` starts with `// Ported from AVS` or
    `// Ported from ShaderSaver`;
  - no source file mentions `import-upstream-shaders`, `canonicalizeImported`,
    `paletteApplication`, `IMPORTED_POST` or `detectUpstreamCompatNames`;
  - `tests/canonical-shader.test.ts` contains no `toBe(53)` hard-coded shader count;
  - `THIRD_PARTY_SHADERS.md` contains no `## AVS` / `## ShaderSaver` heading.
- Add the removed-id check to the existing shader-source/manifest suite if a separate file is
  unwanted.

**Verify:** `npm test` — the guard fails if any file is restored.

## Final verification

1. `npm run typecheck` — registry, manifest and script types are consistent.
2. `npm test` (or `npm run coverage`) — all suites pass with the new guard.
3. `npm run quality` — typecheck + coverage + `fallow` with the reduced source set.
4. `npm run check-shaders` (desktop/Xvfb) — compile + render all 25 shaders in WebGL 1 and 2.
5. `npm run check-animation-runtime` — phase continuity, pause/resume, suspension, midnight.
6. `npm run build && npm start` — settings gallery shows 25 cards, no empty `Clocks`
   heading, no console error from a missing registry entry.
7. Reproduce the shipped artifact: `npm run dist`, then confirm the built bundle and
   AppImage/deb payload contain no `avs-`/`shadersaver-` strings.
8. Config sanity: a hand-written `config.json` with `"shader": "avs-matrix"` and an
   `avs-matrix` rotation entry still starts (falls back silently, per the chosen policy).

## Out of scope

- `docs/refs/` (Atelier) and its `PROVENANCE.md` — untracked (`git ls-files docs/refs` is
  empty), so it is outside the removal regardless.
- `reference/*.yml` palette sources and `scripts/generate-palettes.mjs`.
- LYGIA simplex-noise code inlined in `opal-film` and `ink-bloom`.
- `.pi/plans/*` historical records.

## Outcome (implemented)

All phases landed. 25 shaders remain; 61 files deleted; 9 files edited; 1 test file added.

Verification results:

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npx vitest run` | 32 files / 183 tests pass |
| `npm run build` + dist grep | bundle has no `avs-`/`shadersaver-` id |
| `npm run check-shaders` | 25/25 shaders + settings/preview/preset/IPC pass in WebGL 1 and 2 |
| `npm run check-animation-runtime` | pass in WebGL 1 and 2, including the synthetic midnight wrap |
| `npm run quality` | **still fails, pre-existing** — see below |

Two follow-ups that diverge from the plan:

1. **The synthetic clock fixture needed integer-second quantization.** A raw
   `mod(uDate.w + uTime, 86400.0)` comparison is not float-exact: `86399.0 + 2.2` loses
   precision at that magnitude, so the fixture renders `float(int(secs))`, matching what the
   real clock shader did with `int(mod(timeSecs, 60.0))`.
2. **`npm run quality` was already red at `aa2815e`**, so it cannot be a green gate for this
   change. A pristine `HEAD` checkout reports **2 dead exports and 14 above-threshold
   complexity findings**; after this change it reports **1 dead export**
   (`src/shared/color-palettes.ts :4 colorFamilies`, used only inside its own module) and
   **2 findings** (`tests/shader-manifests.test.ts :37 assertUniformContracts` cognitive 16,
   `scripts/check-animation-runtime.cjs :16 checks` CRAP 30.0). Both are untouched by this
   removal and were already failing; the change strictly reduces the count. Fixing them is
   out of scope here.
