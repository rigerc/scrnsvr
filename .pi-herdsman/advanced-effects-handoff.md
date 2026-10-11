# Advanced effect pipeline implementation handoff

## Scope / changed files
- `src/renderer/core/effects.ts`: ordered intermediate/final pass scheduler; preserved layer-boundary `uOriginal`; typed metadata uploads; bounded scratch pool; per-instance double-buffered feedback; safe zero-delta presentation; reset/resize/bypass/failure/disposal lifecycle.
- `src/renderer/effects/advanced.ts`: exports `advancedEffectRegistry` for Bloom and Datamosh / Trails using shared authoritative manifests.
- `src/renderer/effects/bloom-{extract,horizontal,vertical,combine}.glsl`: original extraction -> horizontal Gaussian -> vertical Gaussian -> final intensity/strength combine shaders, static ES1 loops and texel-center clamping.
- `src/renderer/effects/datamosh-trails.glsl`: actual feedback, frame-rate-adjusted persistence/decay, selectable Trails/Datamosh and local slow bounded displacement.
- `src/renderer/effects/index.ts`: registers advanced registry plus existing VHS only; lead still owns merging `additionalEffectRegistry`.
- `tests/runtime-effects.test.ts`: six new advanced tests plus unchanged legacy behavior checks (14 tests total).
- `scripts/check-effects.cjs`: extended real WebGL1/2 assertions and labeled captures.
- `runtime.ts` did not need changes. No shared/settings/stateless/package/docs edits, install, staging or commit.

## Lifecycle decisions within approved scope
- One scratch target for a single simple layer; two for a multi-layer simple stack. Retain the second across nonempty edits as before; remove the third when multipass is no longer active. Multipass uses three scratch targets irrespective of count.
- Each enabled temporal instance gets two history surfaces, allocated lazily at drawing-buffer resolution. Layer limit remains eight. Eight temporal layers peak at 18 color textures (2 scratch + 16 history); Bloom plus seven histories uses 17 (3 + 14).
- A positive active delta advances feedback exactly once per instance. A zero active delta presents the last displayed history via a cached copy program. Initial/reset history renders once from input with `uHistoryValid = 0`, then repeated zero-delta redraws never accumulate.
- All effect config changes invalidate histories without resetting effect time. Actual dimensions changes invalidate history; repeated unchanged ResizeObserver redraws freeze it. Disable/removal/intensity zero releases that instance's history; teardown releases all programs/shaders/targets/geometry/cache locations.
- Failed target/history allocation safely bypasses the whole stack to the base, releases partial buffers, retains config, reports one stack warning and retries only on dimensions/config changes. Successful recovery clears the warning and permits re-notification of later failures.
- Failed intermediate/final compilation disposes all partial programs and skips the layer. Edits permit retry; success clears the instance warning. No new context/dependencies.

## Validation performed
1. `npx vitest run tests/runtime-effects.test.ts tests/runtime-animation.test.ts tests/renderer-effects.test.ts tests/playback.test.ts tests/animation-clock.test.ts` — **5 files / 22 tests passed**.
2. `npx tsc -p tsconfig.json --noEmit` — **passed**.
3. `node scripts/check-effects.cjs --capture-dir /tmp/scrnsvr-advanced-effects` — **passed WebGL1 and WebGL2** using existing Electron software GL. Each version: peak textures 18, 126 program creations, 136 texture uploads, one intentional advanced allocation-failure diagnostic; no tracked shaders/programs/textures/framebuffers/renderbuffers/buffers or OGL uniform-cache entries remaining after teardown.
4. `node scripts/check-animation-runtime.cjs` — **passed WebGL1/2** phase continuity, pause GPU hold, resume, suspension, midnight/custom timing.
5. `git diff --check -- src/renderer/core/effects.ts src/renderer/effects/index.ts tests/runtime-effects.test.ts scripts/check-effects.cjs` — **passed**; final scoped diff inspected.

GPU assertions cover synthetic multipass original preservation/repeats, every Bloom control, every temporal control, real moving input with persistent output, Trails/Datamosh distinction and block sizes, 30/60fps persistence within RGBA8 tolerance, numerical feedback-instance independence, paused forced-redraw pixel identity, enable/reorder/resize resets, odd portrait/landscape sizes, DPR2 scratch/history dimensions, zero intensity, partial history allocation failure/recovery, eight-layer bounds and complete cleanup. Existing VHS checks remain intact.

## Captures / observed appearance
- `/tmp/scrnsvr-advanced-effects/webgl2-contact-sheet.png`
- `/tmp/scrnsvr-advanced-effects/webgl-contact-sheet.png`
- Individual labeled fixtures include `bloom-dark-{clean,glow}`, `trails-moving-{initial,persistent,current-input}`, `datamosh-two-instances`, `advanced-{dark,colorful,geometric}-{bloom-default,bloom-max,datamosh-max}`.
- Inspected WebGL2 contact sheet and individual frames: bloom gives spatial glow around bright lines/spot; high strength/zero threshold lifts the colorful plasma as intended; moving trails retain a smooth bar tail; max Datamosh produces local displaced/smeared blocks, not a full-screen flash.

## Remaining integration / limitations
- Lead: merge stateless registry into root index, run all17 catalog harness and full tests/build/settings acceptance. No overlapping source ownership remains from this assignment.
- Runtime/browser compilation is source of truth here; Shadereye MCP tools were not exposed to this agent. Checks use software GL, not a hardware GPU or performance benchmark. Electron emitted non-failing X11/ReadPixels performance messages.
- Current shader decay is frame-rate-adjusted; feedback storage is RGBA8, so small frame-rate differences from repeated quantization are expected (tested tolerance <=5 channel levels).
