---
title: "Prevent process churn during screensaver rotation"
status: done
created: "2026-09-30T16:25:53.696Z"
updated: "2026-09-30T17:08:48.955Z"
type: fix
---

## Scope

Analyze and fix audio-capture process churn during shader rotation. User approved implementation with “fix”; the focused audio-lifetime change and regression tests are complete.

## Confirmed renderer/audio findings
- `src/renderer/index.ts:44-45` disposes the old scene before mounting the new scene.
- `src/renderer/core/runtime.ts:46-48,97-98` attaches audio per scene and unsubscribes on disposal.
- `src/main/audio.ts:56,65` immediately kills capture when its final subscriber leaves and spawns `parec` when the next subscriber arrives.
- In-memory reproduction using the actual bundled PlaybackAudio with mocked child_process: initial scene starts one helper; five unsubscribe/resubscribe handoffs result in six starts and five kills.
- `src/renderer/core/runtime.ts:31,117-127` already reuses the Renderer/WebGL context per canvas.

## Phase 1: Complete diagnosis

- [x] Trace renderer swap, GPU resource disposal, and audio subscription lifetime.
- [x] Reproduce audio helper churn without modifying repository source.
- [x] Receive independent main-process/window/idle lifecycle and build-artifact analysis (`result:rotation-lifecycle#1`).
- [x] Distinguish audio-helper churn from an actual Electron process restart: source, dist/main/index.js, and release/linux-unpacked/resources/app.asar use IPC to existing windows during rotation. No Electron restart/reload/window creation occurs in that path.

### Final diagnosis
The confirmed churn is `parec` capture restart across last-subscriber handoffs between audio-using scenes. The original running deployment was not PID-traced. The subsequent isolated Electron smoke test retained main, renderer, and helper PIDs across five swaps. If Electron itself restarts in the user's deployment, investigate a runtime crash or activation/restart path separately.

The independent analysis suggested suppressing identical picks in main; however, `src/renderer/index.ts:41` already returns early for the current key. Redundant IPC for a single-entry rotation therefore does not remount the scene or restart capture. Main's initial exclusion key is unseeded, so the first tick can select the initial scene again, but that is a separate selection inefficiency, not the confirmed process-churn cause.

Normal idle activation creates a new window group; one-shot --open exits on dismissal. These are activation lifecycles, not timed rotation. GPU/renderer crash diagnostics would help distinguish unexpected helper changes but no crash has been demonstrated.

## Phase 2: Proposed focused fix

- [x] Add a 250ms cancellable idle-shutdown grace period to PlaybackAudio when the final subscriber unsubscribes.
- [x] Cancel pending shutdown when a new subscriber arrives and reuse the capture process.
- [x] Stop only when no listeners remain at expiry.
- [x] Keep explicit stop, disable, and application quit immediate; cancel pending timers.
- [x] Keep one unreferenced timer; repeated unsubscribe calls do not extend the deadline.
- [x] Cancel pending shutdown on capture failure, preserving the error state.
- [x] Preserve existing Electron window and WebGL context reuse.
- [x] Validate actual renderer/IPC handoff timing using the production preload and runtime: five reactive-to-reactive swaps had main-side unsubscribe/subscribe gaps of approximately 0.6–9.2ms, well below 250ms.

Implementation: `src/main/audio.ts`. Regression tests: `tests/audio-capture.test.ts`.

## Phase 3: Verification

- [x] Regression tests cover repeated handoffs without respawn or audio-level reset; shutdown after 250ms; idempotent unsubscribe; multi-window subscribers; immediate disable and stop; non-audio gaps allowing intentional restart; stale child events; failure during handoff; disabled capture without timers.
- [x] New tests reproduced six failures before implementation, then passed with the fix.
- [x] `npm test`: 38 files, 248 tests passed.
- [x] `npm run typecheck`: passed.
- [x] `npm run build`: passed; local dist refreshed.
- [x] `git diff --check`: passed.
- [x] Temporary real-Electron smoke harness exercised production preload IPC and actual runtime mounts for five reactive shader swaps. Main and renderer PIDs, helper PID, and WebGL context stayed unchanged; one helper spawn total. Final scene disposal released capture after the grace period.

Smoke-test limitation: the capture command was replaced with a real inert OS child to avoid depending on or capturing desktop audio. Thus this verifies actual process lifetime and IPC/GL timing, not PulseAudio/PipeWire capture behavior. The harness is outside the repository under `/tmp`.

Unrelated user-owned change to `AGENTS.md` was left untouched. Leitfaden tools/skill were unavailable in this session, so no external project/task records were changed.

## Verification already run

Before implementation, the targeted suite passed 13 tests but lacked handoff coverage. After implementation, the full suite passes 248 tests; see Phase 3 for completed verification. Patch release v0.6.1 requested by the user.