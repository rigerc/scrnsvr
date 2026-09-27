---
title: "Canonical mainImage + fragCoord shader ABI"
status: draft
created: "2026-09-27T20:52:29.901Z"
updated: "2026-09-27T20:53:23.602Z"
type: refactor
---

# Canonical `mainImage` + `fragCoord` shader ABI

Make every checked-in `shader.glsl` a Shadertoy/Shadereye-renderable
`mainImage(out vec4, in vec2)` source. scrnsvr keeps a WebGL1 `main()` wrapper
that it prepends at compile time, and runtime uniforms stay DRIVER-supplied via
`#ifdef SCRNSVR` / `#else` manifest-default fallbacks.

## Decisions

- `shader.glsl` is the single source of truth: directly passable to
  `shadereye render_shader` with no generated intermediate.
- scrnsvr compiles `#define SCRNSVR 1` + `shader.glsl` + a fixed 4-line `main()`.
  Detection is automatic (`void mainImage(` present, no `void main(`), so old and
  new shaders compile side by side during the incremental migration.
- Imported effects keep an `upstreamImage(...)` helper; their post pipeline
  (palette + contrast/brightness/saturation) folds into the single `mainImage`.
- Duplicated `#else` defaults are enforced by a test that parses every
  `shader.glsl` and compares each `const` with its `manifest.ts` default. No drift.
- Engine fallbacks: `#define uTime iTime`, `#define uResolution iResolution.xy`,
  `const vec4 uAudio = vec4(0.0)`, `const vec4 uDate = vec4(2026.0, 9.0, 10.0, 46800.0)`.
- Selects fall back to the option index constant; bool/int/float/color map directly.
- Appearance must not change. Verified against a pre-migration render baseline.

## Phase 1 — Shared ABI + runtime
- Add `src/shared/shader-source.ts` (`builtinFragmentSource`, `isCanonicalShaderSource`,
  `compiledFragmentSource`).
- `src/renderer/core/runtime.ts`: compile `compiledFragmentSource(shader.source)`.
- `scripts/lib/browser-checks.cjs`: `createProgram` compiles the same wrapped form;
  export the local wrapper so a parity test can compare it with the TS module.
- `tests/shader-source.test.ts`: wrapper invariants + TS/CJS parity.

## Phase 2 — Codemod + migration
- Add `scripts/lib/canonical-shader.mjs`: preamble generation from manifest controls,
  `canonicalizeNative` (main-only → mainImage, `finish`→returning helper,
  `vUv`→`fragCoord/uResolution`), `canonicalizeImported` (strip compat `#define`s,
  normalize `iTime`/`time`/`iResolution`/`resolution`/`iMouse`/`iTimeDelta`/`iFrame`/`iDate`,
  keep `upstreamImage`, fold post into `mainImage`).
- Add `scripts/migrate-shaders-to-mainimage.mjs` (bundles registry via esbuild, rewrites
  all 53 `shader.glsl`).
- Run migration; spot-render canonical files through the shadereye MCP.

## Phase 3 — Adapter for future imports
- Rewrite `emitModule`/`adapt` in `scripts/lib/upstream-adapt.mjs` to emit the canonical
  form directly; update `tests/upstream-adapt.test.ts`.

## Phase 4 — Contract tests
- `tests/shader-manifests.test.ts`: keep uniform-declaration checks; assert canonical
  shape (no `main`, no `varying`, no compat macros) and `#else` defaults == manifest.

## Phase 5 — Verification
- `npm run typecheck && npm test`.
- `check-shaders --baseline /tmp/scrnsvr-baseline.json` (WebGL 1 + 2, all 53) for
  byte-level appearance equivalence.
- `check-reactive-audio`, `check-animation-runtime`.
- Shadereye render sweep of the migrated `shader.glsl` files.

## Phase 6 — Docs

Skipped at the user's request. Existing authoring docs will be stale for the
Shadereye workflow; no documentation edits in this change.

## Verification checklist
- [ ] `npm run typecheck` clean.
- [ ] `npm test` green (including fallback-consistency + canonical-shape).
- [ ] `check-shaders --baseline` delta under threshold for every shader, both contexts.
- [ ] Shadereye renders every `shader.glsl` without a generated file.
- [ ] `upstream-adapt` re-import produces canonical sources.