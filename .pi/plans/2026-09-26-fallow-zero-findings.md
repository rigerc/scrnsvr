---
title: "Drive fallow to zero findings"
status: draft
created: "2026-09-26T19:20:53.418Z"
updated: "2026-09-26T19:41:02.656Z"
type: refactor
---

# Drive `fallow` to zero findings

## Goal

`npx fallow` exits 0 with **0 dead-code issues, 0 clone groups, 0 complexity findings**, without
hiding real problems. Everything else (`npm run typecheck`, `npm test`, `npm run build`) stays green.

## Baseline

Committed progress: Phase 0 `f5ef7cb`, Phase 1 dead code `419d03b`, coverage harness `3953b8d`.
Dead exports **9 → 1** (`SettingsPanel`, owned by workstream C), MI **89.0 → 89.6**, clone groups
still **5**.

Numbers are scored from **real coverage** (`fallow` reads `coverage/coverage-final.json` via
`.fallowrc.json`). Overall statement coverage: **22.17%** — `src/settings/**` and `src/renderer/**`
sit at ~0%, which is exactly where the CRAP findings live.

```
Metrics: dead files 0.0% (0 of 122) · dead exports 0.6% (1 of 165) · MI 89.6 (good)
Duplication: 5 clone groups
Complexity: 46 findings above threshold — 9 critical · 16 high · 21 moderate
```

Wiring real coverage moved findings rather than only deleting them (expected): `uniformValue`
(estimated CRAP 97) and `daemon.poll` (88) fell below the CRAP threshold, while genuinely uncovered
`daemon.readLogindIdleSeconds` (42) and `shared/clock.formatClock` (56) surfaced. Treat the numbers
below as the working target, and re-measure after each workstream.

### Two integration facts that shape the fixes

1. **`src/main/index.ts` and `src/renderer/index.ts` are pure side-effect bootstraps.** They run
   `app.whenReady()` / `addEventListener` at import time, and the functions holding the findings
   (`createRendererWindows`, `createRendererWindow`, `valuesFor`, the IIFE) are module-private.
   Importing the module in a test cannot work. **Extract the pure decision logic into new
   importable modules**, test those, and leave a thin bootstrap behind.
2. **`scripts/generate-palettes.mjs` writes the generated file as an import side effect.** A test
   importing it would rewrite `src/shared/palettes.generated.ts`. Its pure helpers must move to an
   importable module (e.g. `scripts/lib/palettes.mjs`) before they can be covered.

### Finding inventory

**Dead code — 1:** `src/settings/index.ts:49` `SettingsPanel` — cleared by workstream C's suite
importing the class directly (the class is exported on purpose).

**Duplication — 5 clone groups**, all in `scripts/*.cjs`, keys `dup:c77b3abb6f87acd9-r1…r5`:
re-exec bootstrap (`r1`), software-GL switches (`r3`, `r5`), quit tail (`r2`), repeated
"loadFile + poll for `[data-control]`" block (`r4`).

**Complexity — 46** (`!` = cyclomatic/cognitive exceeded, must refactor; `*` = CRAP-only)

| File | Count | Findings |
|---|---|---|
| `src/settings/index.ts` | 17 | `renderRotationList:421` (cog 19 `!`); crap-only: `:427`, `loadShuffleEntry:468`, `updateSchemeHint:320`, `savePreset:504`, `renderPresets:524`, `constructor:66`, `thumbnailObserver:140`, `importNoctaliaColors:347`, `:597`, `render:79`, `setRotation:410`, `fillSchemeOptions:17`, `activateTab:99`, `:117`, `select:264`, `:384` |
| `scripts/check-shaders.cjs` | 5 | `renderChecks:32` (29/57 `!`), `:158` arrow (14/16 `!`), `render:62`, `uiChecks:187`, `assertScene:200` |
| `src/settings/custom-shader-editor.ts` | 3 | `validateCustomShader:4`, `openCustomShaderEditor:27`, `:66` |
| `scripts/generate-palettes.mjs` | 3 | `buildPalette:44` (cc 11), `parseScalar:12`, `:27` |
| `src/main/index.ts` | 3 | `createRendererWindows:50` (cc 11), `createRendererWindow:30`, `:162` |
| `src/renderer/core/uniforms.ts` | 2 | `uniformValue:4` (cog 24 `!`), `randomizeUniforms:35` (cog 20 `!`) |
| `src/renderer/index.ts` | 2 | `:11` iife (cc 10), `valuesFor:20` |
| `src/renderer/core/clock.ts` | 2 | `update:60`, `tick:43` |
| `scripts/import-upstream-shaders.mjs` | 2 | `adapt:60` (33/32 `!`), `replaceFirstMainImage:48` |
| `src/main/daemon.ts` | 1 | `readLogindIdleSeconds:72` |
| `src/shared/clock.ts` | 1 | `formatClock:41` |
| `src/main/cli.ts` | 1 | `parseArgs:14` (cog 18 `!`) |
| `src/settings/shader-controls.ts` | 1 | `mountShaderControls:4` (25/73 `!`) |
| `src/renderer/core/runtime.ts` | 1 | `oglValue:10` |
| `scripts/check-custom-shaders.cjs` | 1 | `:25` arrow |
| `tests/shader-manifests.test.ts` | 1 | `:37` arrow (12/24 `!`) |

### The 9 must-refactor functions

`adapt` (33/32, 269 LOC) · `renderChecks` (29/57, 125 LOC) · `mountShaderControls` (25/73, 123 LOC) ·
`uniformValue` (cog 24) · `randomizeUniforms` (cog 20) · `renderRotationList` (cog 19) ·
`parseArgs` (cog 18) · `check-shaders:158` arrow (14/16) · `tests/shader-manifests:37` arrow (12/24)

## Strategy

1. **Dead code** — de-export internal helpers, delete genuinely dead types, fix generators instead of
   generated files, and let real test usage resolve the last export.
2. **Duplication** — one shared Electron harness that consumes the existing
   `src/shared/gpu-flags.ts` through a built `dist/shared/gpu-flags.js`, deleting all four inline
   copies of the switch list plus the re-exec, bundle and quit-tail blocks.
3. **Complexity** — split the 9 must-refactor functions by responsibility, and clear the CRAP-only
   findings with **real coverage** (already wired), not suppression. Electron-only scripts cannot be
   covered without a display: reduce their complexity by extraction, and reserve
   `health.thresholdOverrides` **with a written `reason`** for irreducible linear checklists. Never a
   blanket file-level `ignore`.
4. **Gate** — pinned tool, real coverage, one command.

## Phase 0 — Freeze the WIP baseline — DONE (`f5ef7cb`)

## Phase 1 — Dead code — DONE (`419d03b`)

De-exported `clamp01`, `uniformValue`, `validateCustomShader`, `softwareGlSwitches`,
`RotationEntrySchema`; deleted `RotationEntry`; dropped the `PaletteVariant` re-export and the
`ColorRole` generator line (regenerated); added `tests/gpu-flags.test.ts`. `SettingsPanel` stays
exported for workstream C.

## Phase 2 — Duplication (5 clone groups → 0) — workstream A

New `scripts/lib/electron-harness.cjs`:

- `reexecUnderElectron()` — the `process.versions.electron` guard + `spawnSync` re-exec (kills `r1`).
- `createHarness({ prefix })` — `mkdtempSync` + `app.setPath('userData', …)` (kills `r5`).
- `applySoftwareGl(commandLine)` — read from `dist/shared/gpu-flags.js`, with an explicit
  "run `npm run build` first" error when the bundle is missing (kills `r3`, `r5`).
- `bundle(entry)` — the esbuild `buildSync` + `require` helper the three check scripts each redefine.
- `finish(app, { win, temporary })` — the `win.destroy(); app.quit()` + `app.on('quit', rmSync)` tail
  (kills `r2`).
- `waitForControls(win, { root })` — the "loadFile + poll for `[data-control]`" block (kills `r4`).

Then:
- `scripts/build.mjs`: add `src/shared/gpu-flags.ts` to the node/CJS entry points so
  `dist/shared/gpu-flags.js` exists — `gpu-flags.ts` already documents this contract.
- Rewrite `check-shaders.cjs`, `check-custom-shaders.cjs`, `check-reactive-audio.cjs` and
  `capture-frames.cjs` to consume the harness, keeping only their own assertions.
- `check-shaders.cjs` injects `renderChecks`/`uiChecks` as source via `.toString()`. Anything they
  call must be serializable or explicitly injected, so put self-contained helpers in
  `scripts/lib/browser-checks.cjs` and inject them by name — do not import inside an injected body.

**Verify:** `node --check` on every touched script; `npx fallow --format json | jq '.dupes.clone_groups | length'`
→ `0`; `npx dupes --trace dup:c77b3abb6f87acd9-r<N>` reports no siblings for `r1`–`r5`. Electron
scripts cannot run headlessly here — say so in the commit message instead of implying they ran.

## Phase 3 — The 9 must-refactor functions

| Function | Split into |
|---|---|
| `src/renderer/core/uniforms.ts` `uniformValue` (cog 24) | per-type normalizers (`normalizeFloat`, `normalizeBool`, `normalizeColor`, `normalizeSelect`) behind a type→normalizer lookup; signature frozen |
| `uniforms.ts` `randomizeUniforms` (cog 20) | per-type randomizers + a `visibleWhen` ordering helper, keeping the `bindUniforms` → sort → apply loop readable |
| `src/main/cli.ts` `parseArgs` (cog 18) | a `--flag → handler` table (`setFlag`, `takeValue`, `takePositiveInt`) so the loop body has no branch chain |
| `src/settings/shader-controls.ts` `mountShaderControls` (25/73) | `buildGroup(defs, group)`, `buildRow(def, group)` returning `{ row, sync }`, and `createInput(def)` for the `select`/`bool`/`color`/range branches |
| `src/settings/index.ts` `renderRotationList` (cog 19) | `buildRotationRow(entry, index)` + `refreshRotationEmptyState()`, sharing the row pattern with `renderPresets` |
| `tests/shader-manifests.test.ts:37` arrow (12/24) | named `describe`-scoped cases and table-driven assertions per manifest |
| `scripts/check-shaders.cjs` `renderChecks` (29/57) | `compileProgram`, `renderOnce`, `compareToBaseline`, `collectReport` in `scripts/lib/browser-checks.cjs` |
| `scripts/check-shaders.cjs:158` arrow (14/16) | keep it to IPC handler registration; move `defaultConfig`/baseline plumbing into harness helpers |
| `scripts/import-upstream-shaders.mjs` `adapt` (33/32, 269 LOC) | pure pipeline: `parseSource`, `extractUniforms`, `rewriteMainImage`, `applyAdapterRules`, `emitModule`; the adapter switch becomes a rule table |

Rules: no behavior change. `uniformValue`/`bindUniforms`/`snapUniformValue`/`uniformVisible`
signatures are frozen (5 dependents incl. 2 suites). One function per commit where the file is under
active churn (`uniforms.ts` density 0.86, `shader-controls.ts` accelerating).

**Verify:** `npx fallow health --complexity-breakdown` before/after per function; `npm test`;
`npx tsc --noEmit`; `node --check` + review for the scripts.

## Phase 4 — Clear the CRAP-only findings with real coverage

Steps 1–2 are **DONE** (`3953b8d`): `@vitest/coverage-v8` + `vitest.config.ts` (v8, `json` reporter
→ `coverage/coverage-final.json`) and `.fallowrc.json` `health.coverage`. Run `npm run coverage`
before `fallow` so the map is fresh.

3. **`tests/settings-panel.test.ts`** (jsdom, `// @vitest-environment jsdom`) for the 17
   `src/settings/index.ts` findings: import `SettingsPanel` directly (clears the last dead export),
   then cover mount/render, `activateTab`, `fillSchemeOptions`, `select`, `setRotation`,
   `renderRotationList`, `loadShuffleEntry`, `renderPresets`, `savePreset`, `updateSchemeHint`,
   `importNoctaliaColors`, `thumbnailObserver`, and the two arrows. Stub the IPC bridge and
   `PreviewRuntime`; provide an `IntersectionObserver` shim for `thumbnailObserver`.
4. **`tests/custom-shader-editor.test.ts`** (jsdom) for `openCustomShaderEditor` and
   `validateCustomShader`: override `HTMLCanvasElement.prototype.getContext` with a fake GL object
   (jsdom has no WebGL) and drive the Preview/Save/import-file paths.
5. **Renderer and main coverage**, respecting integration fact #1 above:
   - `src/renderer/index.ts`: extract `resolveShaderSelection(registry, requested)` and
     `resolveShaderValues(...)` into an importable module; test both, plus the pointer-move dismiss
     guard.
   - `src/renderer/core/clock.ts` `update`/`tick`, `src/renderer/core/runtime.ts` `oglValue`,
     `src/shared/clock.ts` `formatClock`.
   - `src/main/index.ts`: extract `resolveRendererTarget(config, override, preview, available)` and
     `rendererWindowOptions(config, bounds, preview)` into an importable module; test the extracted
     logic instead of the bootstrap.
   - `src/main/daemon.ts` `readLogindIdleSeconds`: the seam is already injectable — fake timers plus
     injected `readIdleSeconds`/`inhibit`/`launchRenderer`.
6. **`scripts/generate-palettes.mjs`**: move `parseScalar`, `parseYaml`, `normalizeColor` and a
   `buildPalette(entry, referenceDir)` taking the directory as a parameter into
   `scripts/lib/palettes.mjs`; keep the file read + template + write in the script; cover the pure
   helpers from a node-environment test.
7. Only if a finding survives genuine coverage: `health.thresholdOverrides` for that exact
   file/function with a `reason`. Expected candidates are the Electron-only check scripts
   (`check-shaders.cjs`, `check-custom-shaders.cjs`) whose functions are linear browser checklists.
   Justify any entry in the commit and revisit it if a display-backed runner appears.

**Verify:** `npm run coverage` green; `npx fallow --format json | jq '.health.findings | length'` → `0`;
MI does not regress below 89.0.

## Phase 5 — Make the gate repeatable

Pinned `fallow@3.29.0`, `@vitest/coverage-v8`, `npm run coverage` and `npm run quality` are already
in place (`3953b8d`). Remaining:

- `npm run quality` once the tree is clean, and confirm it exits 0 end to end.
- `npx fallow config` resolves `health.coverage`; `coverage/` stays gitignored while being the gate
  input.
- Optional: `npx fallow audit --base <ref>` before committing larger changes.

## Verification (serial, end-to-end, after every workstream stops)

1. `node --check` on all touched `scripts/*.cjs` / `*.mjs`; `npx tsc -p tsconfig.json --noEmit`.
2. `npm run coverage` — all suites green.
3. `npm run build` — palettes generator, shader registry and the new `dist/shared/gpu-flags.js` entry.
4. `npx fallow` → 0 dead exports, 0 clone groups, 0 complexity findings, exit 0.
5. `npx fallow suppressions` → only intended, reasoned suppressions (target: none).
6. Commit; do not stage `dist/`, `coverage/` or `.fallow/`.

## Risks / notes

- **Real coverage is stricter than estimates.** Findings legitimately move as coverage lands; always
  re-measure with a fresh `npm run coverage` before concluding a workstream is done.
- **Injected-source constraints** in `check-shaders.cjs` (`.toString()` injection) — no imports
  inside injected bodies.
- **No display here** — the Electron check scripts and `capture-frames.cjs` are verified by syntax
  check and review only.
- **Generated files** — `src/shared/palettes.generated.ts` and the shader registry are produced by
  `scripts/*.mjs`; never hand-edit, change the generator and regenerate.
- **Frozen API** — no signature changes in `src/renderer/core/uniforms.ts`; split internals only.

## Ownership for parallel execution

- **Lead** — `.fallowrc.json`, `vitest.config.ts`, `package.json`, `.gitignore`, `README`-level
  wiring, final integration, commits.
- **A — scripts** — Phase 2 (harness + all 5 clone groups), `scripts/build.mjs`,
  `check-shaders.cjs` extraction, `scripts/lib/palettes.mjs` + its test, `import-upstream-shaders.mjs`
  pipeline. Owns `scripts/**` and `tests/palettes-generator.test.ts`.
- **B — src/main + src/renderer** — `uniforms.ts`, `cli.ts`, `daemon.ts`, `src/main/index.ts` +
  extracted module, `src/renderer/index.ts` + extracted module, `core/clock.ts`, `core/runtime.ts`,
  `shared/clock.ts`, and their tests. Owns `src/main/**`, `src/renderer/**`, `src/shared/clock.ts`,
  `tests/shader-manifests.test.ts`, `tests/uniforms.test.ts`.
- **C — src/settings** — `shader-controls.ts` split, all 17 `src/settings/index.ts` findings,
  `custom-shader-editor.ts`, and the jsdom suites. Owns `src/settings/**`,
  `tests/settings-panel.test.ts`, `tests/custom-shader-editor.test.ts`.