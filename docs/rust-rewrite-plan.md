# Native Rust rewrite plan

Status: In progress. The Rust saver renderer is an opt-in drop-in for the C++ renderer, and a GPUI Kit settings spike shows an inline GLES preview through a Wayland subsurface; see [implementation progress](#implementation-progress). Updated: 2026-11-23 (product decisions recorded).

Dependency evaluation completed for the current source baseline: see [executed checks, source findings, and adoption decisions](research/rust-rewrite-evaluation.md). Hyprsaver is a selective reference, `glsl` is the preferred optional AST tool, and stock GPUI's missing Linux external-surface API makes inline preview integration the first implementation gate.

## Goal and scope

Replace Electron/TypeScript and the C++ renderer with a fully native Rust application while preserving scrnsvr's existing shaders, configuration, and user workflows. The final settings UI must be native; retaining a web UI is not the target.

Use a staged migration. Keep the existing app usable until each Rust replacement passes its compatibility checks. Preserve GLSL and the GLES shader-rendering approach initially; changing the shader backend to Vulkan/wgpu is outside this rewrite. GPUI Kit's own UI rendering dependencies are separate from that decision.

The rewrite should consolidate rendering and behavior across settings previews, screensaver outputs, and thumbnail capture. Measure runtime and packaging improvements against the current native renderer, rather than assuming that changing language alone will improve performance.

## Product decisions (2026-11-23)

These were agreed with the maintainer and override any conflicting text below.

- **End state:** one native Rust app. No Electron, TypeScript, Node or C++ at build or run time.
- **Rollout:** build the whole native app on the rewrite branch while `main` keeps shipping Electron releases. Then ship one cutover release, **1.0.0**, that replaces Electron entirely. Keep the Electron/TypeScript and C++ code runnable on the branch for comparison, and delete it in one step just before the release.
- **Supported desktop:** Hyprland only. Other wlr-layer-shell compositors may work but are not promised or tested.
- **Test hardware:** the development machine only (NVIDIA, one 2560×1440 output at 120 Hz, scale 1). Mesa, multiple outputs, fractional or mixed scales and hotplug remain documented as untested; do not block on them.
- **User data:** fresh start. The native app reads and writes `$XDG_CONFIG_HOME/scrnsvr/config.toml` (falling back to `~/.config/scrnsvr/config.toml`). It does not read `config.json`, migrate legacy fields or import favorites from Electron.
- **Reactive audio is dropped:** no `parec`/`pactl` capture, audio envelope or audio settings. The three audio shaders (Reactive Bass Bloom, Reactive Pulse Rings, Reactive Audio Ribbons) stay; `uAudio` is always zero, so they render their quiet state, and custom shaders that read it still compile.
- **Idle:** the daemon uses the Wayland `ext-idle-notify-v1` protocol, and the README also documents running `scrnsvr --open` from hypridle as an alternative.
- **Inhibition:** only Wayland idle inhibitors from apps (and Hyprland `idleinhibit` window rules) prevent activation. No audio-playback check and no `xprop` fullscreen check.
- **Clock:** fixed default time and date formats with the 12h/24h option, plus an optional strftime-style pattern in the config. No locale data.
- **Packaging:** AppImage only. No `.deb`.
- **Settings scope:** everything in the current settings app carries over (shader browsing, search, favorites, controls, locks, randomize/undo, saved looks, effects, shuffle, clock, desktop/Noctalia colors, custom shader editor, thumbnails) except reactive audio.
- **Workflow:** work proceeds autonomously through the milestones, delegated to Codex agents, with commits on the branch as each piece lands.

## Current implementation and migration boundaries

- Electron owns the CLI, configuration, idle daemon, scene resolution, settings, previews, and thumbnails: [`src/main/`](../src/main/) and [`src/settings/`](../src/settings/).
- The C++ renderer owns Wayland layer-shell surfaces, EGL/GLES rendering, effects, fades, clock composition, and dismissal: [`native/renderer/`](../native/renderer/).
- The existing boundary is JSON lines over child-process stdin/stdout. Messages include `scene`, `clock`, `audio`, and `dismiss`; readiness and exit codes control error reporting: [`native-renderer.ts`](../src/main/native-renderer.ts). Since v0.10.0 there is no Electron fallback. Without Wayland or the renderer binary, `--open` exits 1 with the reason and `--daemon` exits 2, which `scrnsvr.service` does not restart (`RestartPreventExitStatus=2`).
- Built-in shader metadata is TypeScript; shader and effect programs are GLSL. Configuration uses Zod defaults, validation, and legacy-field migration: [`config.ts`](../src/shared/config.ts).
- Favorites live in browser local storage separately from configuration: [`discovery.ts`](../src/settings/discovery.ts).

[ADR-002](decisions/0002-native-renderer.md) documents current rendering behavior and known hardware verification gaps. It remains the description of the current implementation until Rust replaces it.

## Architecture

Use one Cargo workspace with five initial crates. Keep modules together unless a separate crate provides a useful dependency boundary. Separate settings so the daemon and saver do not acquire GPUI's windowing/runtime dependencies.

- **`scrnsvr-core`**: configuration types, defaults and validation; shader/effect manifests; uniform and palette resolution; presets; rotation; custom-shader wrapping; shared scene descriptions. No windowing or GL dependencies.
- **`scrnsvr-render`**: shader compilation, uniform upload, effects passes and history, animation clocks, fades, and clock composition. Accept an explicit render target so the same renderer works in a native window, a layer-shell surface, or an offscreen capture target.
- **`scrnsvr-platform`**: Wayland output discovery and surfaces, EGL context/surface management, idle/resume providers, inhibition, and audio capture. Separate platform adapters from policy.
- **`scrnsvr-app`**: CLI entry point, daemon supervision, saver/preview windows, and thumbnail commands. Argless/`--settings` launches the native settings executable. No dependency on GPUI Kit.
- **`scrnsvr-settings`**: GPUI Kit settings executable, application editing state, manifest-driven controls, and preview presentation adapter. Depends on core/render interfaces without exposing GPUI types to them. Keep configuration and shader policy out of view code.

Run the saver as a child process supervised by the daemon. Rendering failure must not terminate idle monitoring. Keep configuration persistence in the application layer; renderer children consume resolved scene snapshots and never write configuration.

During migration, Electron remains responsible for configuration writes until the Rust application takes over. Do not introduce competing writers. In the final app, serialize saves and let the daemon reload validated configuration before launches and rotation, preserving current behavior rather than requiring a new always-running settings service.

### Rendering and UI choices

Retain EGL/GLES and use the compile-checked `glow`/EGL/Smithay/calloop group documented in the [evaluation](research/rust-rewrite-evaluation.md#renderingplatform-group-compile-checked-recommendation). This establishes dependency compatibility, not a working Rust renderer. Keep unsafe EGL/GL operations behind small ownership wrappers; create, use, and destroy GPU resources with the owning context current.

**Settings UI decision: GPUI Kit (`gpui-kit`), as requested.** Use its GPUI re-exports and styled component layer for the existing visual mixer. Do not implement settings in egui, GTK, or a webview. Hyprsaver's egui preview is rendering/lifecycle reference material, not the settings implementation to import. [GPUI Kit architecture](https://gpui-kit.com/docs/)

Use Kit's Slider/NumberInput for numeric uniforms, ColorPicker for colors, Select for modes, Switch/Checkbox for toggles, and its input/editor components for search and custom GLSL. Use a project theme matching [DESIGN.md](../DESIGN.md), stable control entities, and explicit focus/action bindings. Reuse Kit's component state while keeping validation, normalization, undo, and persistence in application/core logic. [Component API](https://docs.rs/gpui-component/latest/gpui_component/)

The researched installation baseline is GPUI Kit 0.9.1. Depend on the facade and commit Cargo.lock; use its matched GPUI packages rather than independently selecting upstream snapshots. Start with Kit's default backend. Its Linux instructions require a graphical Wayland/X11 session and a working Vulkan driver; record the actual transitive system dependencies and Rust minimum from the locked graph. This requirement belongs to settings, not the GLES saver/daemon. [Installation and dependency alignment](https://gpui-kit.com/docs/installation/)

**Early integration gate: GLES preview inside GPUI.** Kit's custom painting APIs do not by themselves establish that an external EGL texture can be imported. Inspect the pinned Linux renderer and establish a supported GPU image/surface handoff, including ownership, format/modifier compatibility, synchronization, release, clipping, resize, and scale changes. Test NVIDIA and Mesa. Do not assume a GL texture ID is a GPUI image or that raw window handles permit reusing a Wayland surface role. [Painting API](https://gpui-kit.com/docs/paint/)

Pinned-source evaluation has now confirmed that `gpui-pre` 0.3.12's public `surface`/`paint_surface` path only supports Apple CVPixelBuffers; `RenderImage` holds CPU image frames. Budget explicit Linux/wgpu renderer integration or another demonstrated native composition adapter. Stock surface painting is not a Linux EGL import solution. The `scrnsvr-settings` spike avoids importing anything: the preview is a Wayland subsurface below a transparent GPUI window, composited by the compositor. See [settings preview gate](#settings-preview-gate-wayland-subsurface-milestone-1). [Evaluation evidence](research/rust-rewrite-evaluation.md#gpui-kit-selected-ui-unresolved-linux-gpu-embedding)

Keep scene resolution, effects, and time in the shared renderer; isolate any platform-specific presentation adapter. A separate native GLES preview window can unblock development while embedding is investigated, but does not meet the final inline-live-preview requirement. If embedding needs a small GPUI adapter/patch, scope and record it explicitly; do not silently switch toolkit, rewrite shaders, or introduce continuous CPU readback. Static thumbnail uploads remain appropriate. Gate further settings work on a demonstrated presentation path.

Validate keyboard navigation, text editing, clipboard/IME, accessibility, high DPI, paused redraw, popovers above the preview, and redraw scheduling. Settings must stop requesting animation frames when hidden or paused except for user-driven updates. The standalone saver keeps its compositor-driven rendering loop, independent of GPUI's UI event loop.

## Crate shortlist and adoption policy

Research and targeted checks completed on 2026-11-13. The [evaluation](research/rust-rewrite-evaluation.md) distinguishes executed parser/driver/unit/compilation checks from source/API review. This is not a tested whole-application dependency set or a request to add every crate. Select compatible versions/features together when implementing each milestone; retain licenses and record MSRV/system-library implications in Cargo.lock/build documentation. Reuse GPUI Kit's re-exports where provided and avoid duplicate GUI runtimes.

### Shader source, parsing, and diagnostics

- **[`glsl`](https://docs.rs/glsl/7.0.0/glsl/) 7.0.0: preferred optional AST tool.** Parsed all 41 production wrappers, 20 effect programs/passes, and 41 raw built-ins in the executed corpus check. Use only for structural inspection where needed, preserve source text, and keep a compatible fallback for unhandled custom syntax. Its documented desktop GLSL target and parser success do not establish semantic GLES validation. Retain BSD-3-Clause notices.
- **[`glsl-lang`](https://docs.rs/glsl-lang/0.8.1/glsl_lang/) 0.8.1: defer.** Parsed all built-ins but rejected Digital Glitch's `active` identifier; setting `default_version: 100` did not fix the mismatch with the current driver. Do not change a working shader merely to accommodate this parser.
- **[`glsl-lang-lexer`](https://docs.rs/glsl-lang-lexer/latest/glsl_lang_lexer/): not independently approved.** The same lexer family classifies `active` as reserved. A token-only path needs separate evidence; it is not an assumed workaround for the parser result.
- **[`tree-sitter-glsl`](https://docs.rs/tree-sitter-glsl/0.2.0/tree_sitter_glsl/) 0.2.0: defer the unmodified grammar.** It loads with GPUI Component's Tree-sitter 0.26.13 and its highlight query compiles, but every corpus shader/effect has recovery errors, including precision-declaration handling in a minimal probe. Partial highlighting may still work; do not use those recovery errors as compile diagnostics. Revisit a corrected grammar or alternative highlighting implementation after the preview gate.

The initial corpus evaluation is complete; retain and extend its cases as source handling moves into Rust. Exercise comments, macros, precision statements, `mainImage`, legacy `main`, prohibited uniforms/samplers, and malformed custom sources. Both tested AST parsers accepted the undefined-variable probe that the driver rejected, and accepted sampler declarations that application policy forbids. Keep bounded custom-source policy checks and actual GLES compile/link validation; retain the last valid preview on failure. Parser failure alone must not reject a previously supported shader. Use `#line`/source-offset mapping where supported so wrapper diagnostics point back to user source. Preserve source text unless a tested transformation is required.

Do not add **[`shaderc`](https://docs.rs/shaderc/latest/shaderc/)** to the initial runtime: it targets SPIR-V compilation and brings native compiler dependencies, whereas the current ABI is GLSL ES/GLES. Keep **[`naga`](https://docs.rs/naga/latest/naga/)** as a future shader-backend/translation evaluation only. Neither is a substitute for compiling existing sources on the target GLES driver, and neither is required merely because GPUI uses another GPU API for UI.

### Rendering, presentation, and event handling

| Crate | Planned use and boundary |
| --- | --- |
| [`glow`](https://docs.rs/glow/latest/glow/) | GLES calls, compile/link diagnostics, active-uniform queries, FBO/effect/history rendering. Driver reflection supplies actual linked uniforms; AST inspection does not replace it. |
| [`khronos-egl`](https://docs.rs/khronos-egl/latest/khronos_egl/) + [`wayland-egl`](https://docs.rs/wayland-egl/latest/wayland_egl/) | EGL initialization and Wayland EGL surfaces. Keep context/surface teardown ordering explicit; use one owned path per backend. |
| [`smithay-client-toolkit`](https://docs.rs/smithay-client-toolkit/latest/smithay_client_toolkit/) | Wayland outputs, seats, layer-shell lifecycle, scaling, and input. Reuse compatible abstractions rather than manually porting every C listener. |
| [`wayland-client`](https://docs.rs/wayland-client/latest/wayland_client/), [`wayland-protocols`](https://docs.rs/wayland-protocols/latest/wayland_protocols/), [`wayland-protocols-wlr`](https://docs.rs/wayland-protocols-wlr/latest/wayland_protocols_wlr/) | Protocol bindings where toolkit coverage is insufficient: idle notifications, fractional scale/viewporter, and layer-shell. Enable relevant client/staging features only; detect compositor capabilities. |
| [`calloop`](https://docs.rs/calloop/latest/calloop/) + [`calloop-wayland-source`](https://docs.rs/calloop-wayland-source/latest/calloop_wayland_source/) | Poll Wayland, IPC, timers, and shutdown sources in the saver/platform loop. Do not run a blocking dispatch loop inside GPUI callbacks. |
| [`winit`](https://docs.rs/winit/latest/winit/) + [`glutin`](https://docs.rs/glutin/latest/glutin/) | Dropped. They were the candidate fullscreen fallback adapter, and v0.10.0 removed the fallback. The saver only targets layer-shell. |
| [`pango`](https://docs.rs/pango/latest/pango/) + [`pangocairo`](https://docs.rs/pangocairo/latest/pangocairo/) | Retain current clock shaping/layout through Rust bindings. Upload only changed clock textures; this does not require a GTK settings UI. |
| [`image`](https://docs.rs/image/latest/image/) | PNG thumbnail/capture encoding and reference image loading. Enable only required codecs; no normal frame-by-frame saver readback. |

### Configuration, desktop integration, and maintenance

| Crate | Planned use and boundary |
| --- | --- |
| [`serde`](https://serde.rs/) + [`serde_json`](https://docs.rs/serde_json/latest/serde_json/) | Typed configuration/manifests and existing JSON-lines protocol. Explicit migrations and validation remain application code. |
| [`clap`](https://docs.rs/clap/latest/clap/) | Existing CLI flags/modes, backend enums, and generated help. Preserve established invocation behavior with fixtures instead of inheriting new parser defaults accidentally. |
| [`directories`](https://docs.rs/directories/latest/directories/) + [`tempfile`](https://docs.rs/tempfile/latest/tempfile/struct.NamedTempFile.html) | XDG base directories and same-directory temporary files persisted by atomic replacement. Assert the exact `scrnsvr/config.toml` path; add flush/sync policy explicitly rather than assuming rename implies durable storage. |
| [`zbus`](https://docs.rs/zbus/latest/zbus/) | Direct logind session-property queries and suspend/resume signals, replacing `busctl` subprocesses when that adapter moves to Rust. Keep D-Bus work off the UI/render thread; do not add another async runtime without a demonstrated need. |
| [`x11rb`](https://docs.rs/x11rb/latest/x11rb/protocol/screensaver/index.html) | Optional. X11 sessions are no longer supported, so X11 idle information is not needed. It could replace the `xprop` fullscreen check for XWayland windows in [`inhibit.ts`](../src/main/inhibit.ts); otherwise keep running `xprop`. |
| [`icu_datetime`](https://docs.rs/icu_datetime/latest/icu_datetime/) | Evaluate localized date/time formatting to replace Intl. Supply OS local-time/time-zone information separately and limit locale data to agreed requirements; verify formatting fixtures and package size. |
| [`thiserror`](https://docs.rs/thiserror/latest/thiserror/) + [`tracing`](https://docs.rs/tracing/latest/tracing/) | Typed core/platform failures and structured diagnostics for startup, backend selection, frame timing, and cleanup. Route renderer logs to stderr to preserve protocol stdout. |
| [`notify`](https://docs.rs/notify/latest/notify/) | Optional file watching only if live external-edit reload is retained/added deliberately. Watch the containing directory for atomic replacement; coalesce events. Not required for the existing reload-at-launch/rotation semantics. |

**Audio capture is not ported.** Reactive audio was dropped (see [product decisions](#product-decisions-2026-11-23)); [`AudioEnvelope`](../src/main/audio.ts) and the `parec` stream have no Rust replacement, and `uAudio` stays zero.

Adoption order: GPUI Kit and the compile-checked rendering group in milestone 1; `glsl` only where structural inspection is required; persistence/CLI/desktop adapters as their milestones move. Defer the rejected parser/grammar paths, optional watches, and DSP changes. Evaluation dependencies were built in scratch projects only; the current Electron build has not acquired Rust dependencies.

## Hyprsaver 0.4.8 reuse evaluation

**Verdict: selective platform/headless adaptation, not an application fork.** Version 0.4.8 builds locally, passes its 153 upstream unit tests, and successfully renders a small headless WebP here. It is an application without a library target. These checks do not validate compositor behavior or feature parity; see the [detailed evaluation](research/rust-rewrite-evaluation.md#hyprsaver-useful-reference-unsuitable-as-the-application-base).

Prefer selective extraction into scrnsvr-owned modules. For each extracted module, record its upstream version/commit, modifications, and MIT copyright/license notice. Check any imported shader or asset provenance separately. Avoid inheriting the entire application and its TOML schema, palette model, and shader assumptions merely to obtain Wayland plumbing.

Source inspection establishes these boundaries for reuse:

- Adapt fractional-scaling, viewport, seat/layer-shell, and headless ownership patterns behind scrnsvr's platform interfaces; preserve provenance.
- Do not import the repeating FPS timer/one-second stalled-callback retry: scrnsvr must keep suspending drawing until callbacks return. Retain independent shutdown deadlines.
- Do not import the shader wrapper, fixed uniform/palette model, or ES3 context defaults. Upstream defaults source to GLSL ES 3.20; preserve our GLES2 ABI, arbitrary controls, ordered effects/history, clock/audio, and integrated animation timing.
- Keep egui, TOML, PID files, playlists, and application state out of GPUI settings/core. Upstream's preview is a Wayland XDG window, not an implemented X11 fallback or idle-daemon replacement.
- Adapt to the checked modern crate group rather than retaining upstream's SCTK 0.19/calloop 0.13/glow 0.14 family. Handle cleanup after partial initialization explicitly.

The upstream changelog describes fixes for blocked EGL swaps after monitor power-off/disconnection while a keyboard grab remained active. Turn that failure mode into a regression scenario; upstream fixes are evidence to inspect, not proof that our integration is correct.

Sources: [release documentation](https://docs.rs/crate/hyprsaver/0.4.8), [source tree](https://docs.rs/crate/hyprsaver/0.4.8/source/src/), [preview implementation](https://docs.rs/crate/hyprsaver/0.4.8/source/src/preview.rs), [changelog](https://docs.rs/crate/hyprsaver/0.4.8/source/CHANGELOG.md), [MIT license](https://docs.rs/crate/hyprsaver/0.4.8/source/LICENSE).

## Compatibility requirements

### Configuration and assets

- Use `$XDG_CONFIG_HOME/scrnsvr/config.toml`, falling back to `~/.config/scrnsvr/config.toml`. The old `config.json` is not read or migrated (fresh start).
- Keep the current settings' meaning, defaults and validation bounds: shader IDs, per-shader values, presets, custom sources, colors, effect instance IDs and order, rotation entries, and clock settings. Drop the audio settings and the legacy `fps`/`monitor` fields.
- Serde deserialization must be followed by explicit validation; deriving defaults alone does not reproduce Zod behavior. Invalid or unknown values fall back to defaults with a logged warning rather than discarding the whole file.
- Keep debounced atomic replacement, actionable save errors, and retry without losing edits.
- Favorites and other UI preferences live in the native app's own state; there is no import from Electron.
- Convert manifests and generated palette/effect metadata to language-neutral data. Preserve the GLSL sources and license records. The final build must not need Node to generate essential assets.

### Rendering and interaction

- Preserve all 41 current built-in shaders, custom-shader restrictions, normalized values, conservative randomization, parameter locks, and saved looks.
- Preserve the ordered effect stack, multipass bloom, per-instance temporal history, bypass behavior, failure recovery, and history reset/resource-release rules.
- Preserve speed-integrated animation, independent effect time, pause/redraw behavior, and suspension-gap handling.
- Keep the clock above effects, including position, font, shadow, opacity, date, and 12h/24h behavior. Replace JavaScript Intl with fixed English default formats plus an optional strftime-style pattern from the config; test time-zone handling and the 12h/24h switch. Keep Pango/Cairo text layout.
- Keep transparent activation, configured fades, rotation through black, and the previous valid scene when a replacement fails to compile.
- Preserve keyboard, click, scroll, touch, and pointer-distance dismissal across the entire output group. Preserve hotplug/scale-change dismissal first; seamless reconfiguration is a separate enhancement.

### Desktop integration

- Keep the existing CLI modes: argless settings, `--open`, `--daemon`, `--preview`, `--shader`, `--thumbnail`, `--output` and `--frames`. `--backend` was removed in v0.10.0.
- Preserve native startup timeout, readiness and exit-code handling. When the saver cannot run (no Wayland session, no wlr-layer-shell, renderer unavailable), `--open` reports the reason and exits 1, and `--daemon` exits 2 so the systemd unit does not restart it. A launch failure in a running daemon is logged, and the next idle launch tries again.
- The saver requires a Wayland compositor with wlr-layer-shell; Hyprland is the supported desktop. GNOME and X11 are unsupported, and there are no fullscreen fallback windows. hypridle is optional, never required.
- Preserve idle thresholds, one active saver group and resume suppression. Idle comes from `ext-idle-notify-v1`; activation is blocked only by Wayland idle inhibitors. Reactive audio capture and the audio/`xprop` inhibition checks are removed.
- Preserve the desktop entry and `scrnsvr.service` user service. The AppImage needs a documented way to install that unit, since there is no package hook.

## Delivery milestones

### 0. Establish the baseline

- Create a feature checklist from current source, tests, and README.
- Export fixtures for configuration parsing/migration, resolved shader values, custom-source wrapping, effect plans, rotation, and audio envelopes. Use fixed times/seeds where applicable.
- Capture representative frames with known dimensions/time/audio, including bloom, temporal history, clock, and transitions. Separate exact data comparisons from driver-tolerant image comparisons.
- Measure idle-daemon RSS/CPU, saver startup, rendering CPU/GPU time, frame pacing, settings startup, and package size under documented conditions.
- Inventory reusable hyprsaver modules and their provenance.
- Record the crate shortlist's license, feature, MSRV, and native-library requirements; identify existing transitive GPUI dependencies before adding overlapping crates.

**Exit:** reproducible fixtures, measured baseline, and a checklist mapping every retained capability to a verification method. No Rust component becomes the default yet.

### 1. Prove the Rust rendering and UI path

- Add the Cargo workspace and a minimal Rust renderer accepting existing scene messages.
- Render representative scrnsvr GLSL into a Wayland layer-shell surface using EGL/GLES.
- Build the GPUI Kit settings executable with one manifest-driven control and a GLES preview presentation adapter. Validate the actual GPU handoff rather than assuming custom painting supports EGL textures.
- Bring the completed corpus findings into Rust compatibility fixtures. Use `glsl` only for needed inspection; keep `glsl-lang` and the unmodified Tree-sitter GLSL grammar deferred unless new evidence resolves the recorded failures.
- Verify paused redraw, resize, scaling, input, context teardown, and recovery after shader compilation failure.
- Test signal/dismiss handling while frame callbacks stop. Decide which hyprsaver platform/rendering modules to extract; settings stays on GPUI Kit.

**Exit:** a demonstrated Rust saver and editable inline preview in GPUI Kit, documented GPU ownership/synchronization, a locked compatible dependency set, and recorded source-parser/windowing decisions. Verify the daemon/saver build does not depend on initializing GPUI/Vulkan. Prototype code is not feature parity.

### 2. Replace the production C++ renderer

- Complete the JSON-lines protocol, including clock/audio updates, readiness, startup errors, EOF, and dismissal.
- Port effects, timing, fades, rotation transitions, per-output resource ownership, input, and clock composition.
- Bound protocol input and pending work; coalesce superseded updates rather than growing an unbounded queue. Keep protocol output on stdout and diagnostics on stderr.
- Allow development builds to select C++ or Rust. Run the existing Electron orchestrator and native checks against Rust.

**Exit:** every shader/effect compiles; rendered parity and lifecycle checks pass; Rust can replace the native renderer while settings and orchestration remain unchanged. Keep C++ available for rollback.

### 3. Move configuration and scene resolution into Rust

- Implement core types, TOML loading with validation, atomic persistence, manifests, palettes, preset resolution, rotation, and custom shader handling. No legacy migration.
- Move shader and effect manifests, palettes and other generated metadata to language-neutral data that Rust reads directly. TypeScript may read the same data during the overlap, but no essential asset may require Node to generate.
- Compare Rust scene plans with the scene plans the TypeScript main process produces for equivalent settings (exported fixtures), ignoring audio.
- Test missing, malformed, and unwritable configuration, unknown/stale shader references, and unavailable effect definitions.

**Exit:** Rust resolves the same scene plans as TypeScript for equivalent settings, and TOML configuration round-trips. The renderer still accepts the existing protocol; application behavior can move independently of GPU code.

### 4. Replace the daemon and launch orchestration

- Implement CLI dispatch, renderer supervision, configuration reload, rotation, startup-failure reporting with the exit-2 contract, and shutdown deadlines.
- Detect idle with `ext-idle-notify-v1` (configured threshold, resume notification, inhibitors respected). Handle suspend/resume via logind over `zbus` if needed for resume suppression. If the protocol is unavailable, log it and keep manual `--open` working; document the hypridle alternative.
- Replace Electron display selection. Define and test the policy for `primary` where Wayland cannot report a primary output; expose the chosen output in diagnostics.
- No audio capture or audio/fullscreen inhibition checks.

**Exit:** Rust `--daemon` runs without GUI initialization or Electron; idle activation, dismissal, resume, and renderer crashes behave correctly. Manual launch remains available when idle capability is unavailable.

### 5. Complete native settings and previews

- Implement settings in GPUI Kit: port shader discovery/search/favorites, live preview, manifest-driven Slider/NumberInput/ColorPicker/Select controls, advanced controls, locks, reset/randomize/undo, and saved looks.
- Port global effects, shuffle, clock controls (including the optional strftime pattern), desktop colors/Noctalia import, global settings, and the custom-shader editor. No audio settings.
- Preserve save status/retry, focus after list edits, keyboard operation, reduced-motion startup behavior, and preview pause.
- Use Kit's native editor/input facilities for custom GLSL; add compatible Tree-sitter highlighting only if needed, and map driver diagnostics back to user source. Keep preview GPU work and background persistence out of UI callbacks.
- Implement thumbnail capture with deterministic render inputs. Use framebuffer readback only for explicit capture, not as the normal presentation pipeline.

**Exit:** the full application works without Electron, with all retained workflows checked against the baseline and design requirements in [DESIGN.md](../DESIGN.md).

### 6. Package, validate upgrades, and remove legacy code

- Produce a native AppImage (no `.deb`) with the existing desktop/service identity, a way to install the user service, and the minimum glibc/GL/Vulkan runtime documented.
- Add Rust formatting, Clippy, unit/contract tests, shader compilation, rendering checks, and an AppImage smoke check to the build workflow.
- Verify clean installation, a first run with no configuration, service start/stop, and that the release notes explain the fresh start (old `config.json` is ignored).
- Remove Electron/TypeScript runtime code, the C++ renderer, obsolete generators, npm and electron-builder in one step just before the 1.0.0 release.
- Update README, build instructions, dependency/license notices, and architecture documentation to describe the shipped app.

**Exit:** the 1.0.0 AppImage passes the release checks on Hyprland, and no Electron, Node, or application-owned C++ component is needed to build or run the final app. Native system libraries remain allowed.

## Verification and release gates

Use existing tests as behavioral evidence, then port meaningful cases as ownership moves. Start with `tests/config.test.ts`, `tests/native-renderer.test.ts`, daemon/audio suites, runtime/effects suites, and the settings interaction suites. Adapt `scripts/check-native.cjs` during the overlap, then replace its Node harness before final removal.

Required checks before cutover:

- Exact comparisons for normalized configuration, scene plans, shader/effect metadata, and deterministic state transitions.
- GPU checks for all shader/effect programs, representative fixed-time output, multipass/history behavior, transparent activation, fades, failed-scene recovery, and clock composition. Set image tolerances per driver and record why differences are acceptable.
- Lifecycle checks for partial startup failure, startup timeout, stdin closure, signals, daemon stop, stopped callbacks, display power-off, unplug, scale changes, and cleanup of input grabs/cursors/processes/resources.
- Desktop checks on Hyprland. Without layer-shell or Wayland, check that the app reports it is unsupported and the daemon exits 2.
- Hardware checks on the development machine (NVIDIA, one output), including display power-off/resume. Mesa, multiple outputs, mixed or fractional scales and differing refresh rates are untested by decision; list them in the release notes.
- Native UI checks for keyboard-only operation, focus, IME/clipboard, accessibility support, high DPI, resizing, paused edits, malformed custom shaders, and failed saves/retry.
- GPUI/GLES interop checks for image/surface release, synchronization, preview clipping and overlays, resize/scale changes, repeated preview replacement, and unavailable GPU capabilities. Confirm closing settings frees its GPU resources and the independent daemon/saver continues working.
- Performance comparison using identical scenes, resolution, FPS, effects, and hardware. Require no unexplained sustained CPU/GPU or memory regression; confirm rendering stops for outputs without callbacks and resources stabilize across repeated activation.

Keep the Rust app on the branch until these gates pass. Do not delete rollback implementations merely because a milestone has started.

## Open decisions and boundaries

- Settings toolkit is decided: GPUI Kit. Open: the tested GPU preview adapter and any narrowly scoped upstream integration required for inline GLES output.
- Minimum supported Linux/GPUI dependencies: resolve with the spike and packaging baseline; keep settings dependencies isolated. There is no saver window adapter to choose: layer-shell is the only saver target.
- Shader source tooling: `glsl` is preferred for optional inspection; direct source handling and GLES compilation remain authoritative. Open: any corrected editor highlighting grammar, not a change to the supported GLSL ES dialect.
- Primary-output selection on Hyprland: resolve in milestone 4. (Idle provider decided: `ext-idle-notify-v1`.)
- Clock formatting is decided (fixed defaults plus a strftime pattern). Open: acceptable font differences from Chromium text rendering in settings.
- Fractional scaling: evaluate upstream support early; retain current behavior until a tested replacement is available, then document any deliberate improvement.

No implementation-time estimate is committed before the rendering/UI spike establishes the reuse boundary. Keep each milestone reviewable and independently reversible. The first implementation task is milestone 0, followed by the Rust saver/native-preview spike.

## Implementation progress

Recorded 2026-11-14 on the development system (Hyprland, NVIDIA, rustc 1.99.1). Untested combinations from [verification](#verification-and-release-gates) remain untested.

### Done: Rust saver renderer (milestone 1 saver path, milestone 2 replacement)

The Cargo workspace (`Cargo.toml`, `crates/`) has all five planned crates. The four saver crates are the default members; `scrnsvr-settings` builds only when named (`-p scrnsvr-settings` or `--workspace`) so plain `cargo build` never compiles GPUI.

- `scrnsvr-core`: JSON-lines protocol with the C++ reader's leniency, renderer options, output selection, pointer-dismissal distance, the activation/rotation/dismissal timeline, animation clock and audio smoothing, and the `mainImage` wrapper from `shader-source.ts`. No GL or windowing dependencies.
- `scrnsvr-render`: a `glow` port of `gl.cc` and the Pango/Cairo clock from `clock.cc`. One `Renderer` per GL context draws into framebuffer 0, so the same code runs in layer-shell windows and headless pbuffers. `read_rgba` is for explicit capture only.
- `scrnsvr-platform`: dynamically loaded EGL (RGBA8, GLES2 contexts) and SCTK-based layer-shell outputs, seats, frame callbacks and opaque regions.
- `scrnsvr-app`: the `scrnsvr-renderer` executable. It keeps the existing arguments, messages, `ready` line, exit codes 0–3, `--compile-check`, stdin-EOF dismissal, signal handling and `SCRNSVR_RENDERER_DEBUG`.

`SCRNSVR_RENDERER=rust npm run build` (`npm run build:rust`) builds it into `dist/native/scrnsvr-renderer`. The C++ build remains the default and the rollback.

Evidence:

- `npm run test:rust`: 28 unit tests, one fixture test and 6 headless GPU tests pass, with Clippy `-D warnings` and rustfmt clean. The fixture test parses all 47 messages exported from the TypeScript main process by `scripts/export-rust-fixtures.cjs`: 41 built-in scenes, every catalog effect, and a clock message. The GPU tests cover typed uniform upload, opaque premultiplied fades, the rotation overlay, ordered and multipass effects, skipped broken effects, temporal history including zero-delta frames and reset, clock composition and integrated speed.
- `npm run check-native` against the Rust binary compiles all 61 shader and effect programs.
- `node scripts/check-native.cjs --live` passes against the Rust binary: transparent activation, fade-in, rotation through black, broken-scene recovery and dismissal that restores the desktop.
- `electron dist/main/index.js --open --backend layer-shell` with the Rust binary rendered Aurora Veil with bloom, datamosh trails, vignette and a clock. A screenshot matched the C++ renderer's frame by eye, including clock layout. Terminating Electron closed the renderer's stdin, and it exited.
- Rechecked 2026-11-23 on v0.10.0, where the renderer is the only saver backend and `--backend` no longer exists: `npm run test:rust`, `check-native` (61 programs) and `check-native --live` pass with the Rust binary. `electron dist/main/index.js --open` started it, it drew the scene and clock, and real pointer motion (`ydotool`) dismissed it with exit 0. As in C++, the first motion only delivers pointer enter and sets the origin; the next motion past 12 px dismisses.
- `npm run check-parity`: both renderers gained `--capture PATH --size WxH --frames N --delta MS`, which renders the plan from stdin headless and writes the last frame as PAM. All 41 built-ins, each of the 17 effects alone, a stacked bloom/trails/aberration/vignette plan, and a clock plan were captured at 320×180 after 30 frames 33 ms apart (reactive shaders with a fixed audio envelope). All 60 Rust frames are **bit-identical** to C++ on this NVIDIA driver. A negative control that renders one frame fewer is reported as different.
- On a single output, 60 fps, with the same scene and effects: C++ used 1.5–2.3% CPU and Rust used 1.4–2.4% over two 8-second samples. RSS was 114–175 MB for both, dominated by the driver. These are smoke measurements, not the milestone 0 baseline.

Decisions made during implementation:

- **No calloop in the saver.** The loop polls two descriptors and must re-dispatch whenever `prepare_read` finds events that EGL queued during a swap. An explicit `poll` loop reproduces the C++ behaviour exactly. Revisit calloop if more sources are added (timers, IPC, D-Bus).
- **SCTK without default features.** Its keyboard handler needs xkbcommon only to decode keys, and any key press dismisses. `wl_keyboard`, `wl_pointer` and `wl_touch` are bound directly. Outputs, seats, the compositor and layer-shell use SCTK.
- **Headless EGL requests RGBA8.** An unconstrained pbuffer config selected a low-precision format on NVIDIA. That is harmless for compile checks but wrong for capture.
- **EGL displays are process-wide.** Terminating an `Egl` invalidates every other user of the same native display, so keep one `Egl` per native display. Tests serialize their GPU use.
- No hyprsaver source was copied. SCTK patterns were written against 0.21 directly, so no upstream notices are required yet.

### Settings preview gate: Wayland subsurface (milestone 1)

`crates/scrnsvr-settings` is a GPUI Kit 0.9.1 window with a searchable shader picker, manifest-driven sliders for each shader's basic numeric controls, a pause button and a live preview. It uses the shared Rust catalog and scene resolver for its controls and default preview scenes. It persists nothing; the Electron settings remain the product.

How the preview is presented (`src/preview.rs`):

- **No texture import.** The adapter creates its own `wl_surface` as a subsurface of GPUI's window surface, using GPUI's `wl_display` and `wl_surface` from its raw handles. It gives that surface its own EGL window, GLES2 context and `scrnsvr-render` renderer. GPUI never sees the preview's pixels and nothing is read back.
- **Stacking.** The subsurface is placed *below* the window surface. The window is transparent and the stage element leaves its rectangle unpainted, so GPUI popovers and menus drawn over the preview stay on top.
- **Placement.** A canvas paint callback reports the stage's clipped bounds and scale. Position is parent-committed state, so it moves with GPUI's next frame; size changes resize the EGL window.
- **Pacing.** The subsurface is desynchronized. A 4 ms GPUI timer on the UI thread renders a frame only after the previous frame callback returned, so a hidden window renders nothing. Pause stops drawing and resuming does not animate the paused interval.
- **Input.** The subsurface has an empty input region; GPUI receives all input.
- **Teardown.** The renderer is dropped with its context current, then the EGL surface, context, EGL window, subsurface and surface are destroyed. GPUI's surface is borrowed and never destroyed.

Evidence (2026-11-23, Hyprland 0.57, NVIDIA, 2560×1440 at 120 Hz, scale 1, release build). `SCRNSVR_SETTINGS_SMOKE=steps` drives the window with in-app synthetic clicks and prints each step with a timestamp; full-screen captures were taken throughout and lined up with those timestamps:

- The preview rendered Aurora Veil inline at 1942×1361 and kept pace with the display (about 117 frames per second).
- Dragging Brightness changed the uniform and the visible preview within one capture interval (about 0.25 s).
- The shader menu, 520 px wide, opened over the preview and drew above it.
- Switching to Chromatic Plasma replaced the scene. Widening the sidebar to 640 px moved the subsurface and resized it to 1622×1361 in step with the GPUI layout.
- Paused: the frame counter stopped and the preview pixels were unchanged across 1.2 s of captures. While running, the same region changed by over a million pixels across three captures.
- No errors on stderr; the process exited cleanly.
- `cargo tree -p scrnsvr-app` contains no GPUI crates, so the daemon/saver build does not depend on GPUI or Vulkan.

Findings and limits:

- **Use release builds to judge responsiveness.** Unoptimized GPUI lagged the on-screen UI several seconds behind the app's state in the same run; the release build kept up.
- **The window background needs no GPUI Kit patch.** Kit's window plugin paints `tokens.background` over the whole surface, which would hide the preview. `gpui_base::Root` applies its own style after the plugin's, so `clear_window_background` sets a transparent background on `Root` and leaves the token opaque for dialogs, sheets and tabs. Panels paint `theme.background` themselves. Kit 0.10.0 keeps the same order. Kit does not document that order, so the `root_background_overrides_the_window_plugin` test draws a headless Kit window and checks the painted quads. Without the override an opaque quad covers the window (the control case), and with it none does. Making the override a no-op fails the test. Rechecked on screen after the change: the preview shows through, the menu draws over it, and the shader switch and relayout work.
- **The test enables `test-support` on `gpui-pre` directly.** GPUI Kit's own `test-support` feature also resolves its optional `gpui-fast` backend, which conflicts with the locked `gpui-pre` stack. The test-only additions to `Cargo.lock` (criterion, proptest and others) do not reach the saver build.
- **Preview rendering runs on GPUI's UI thread.** It was smooth here, but a slow shader or driver stall would delay UI input. Moving the preview to its own thread with its own event queue is the likely production shape.
- **Fractional scales round the buffer scale up** and let the compositor downsample. Only scale 1 was tested.
- **Not tested:** Mesa, scale changes while open, multiple outputs, moving between monitors, Sway or KDE, keyboard/IME/accessibility, and compositor effects that apply to transparent windows (blur, opacity rules).
- X11 would need a child-window adapter. Since v0.10.0 the saver requires Wayland, so the settings app can require it as well.

Gate status: the presentation path is demonstrated on one driver and compositor. It meets the milestone 1 requirement for an editable inline preview without CPU readback or a GPUI fork. Mesa is out of scope by decision; settings work can build on it. Still check a scale change on this machine if one becomes possible.

When upgrading GPUI Kit (pinned at `=0.9.1`):

1. Run `cargo test -p scrnsvr-settings`. The window background test fails if Kit changes how `Root` and its window plugin style the surface.
2. Run `SCRNSVR_SETTINGS_SMOKE=steps cargo run --release -p scrnsvr-settings` and check on screen that the preview is visible, the shader menu draws over it, and relayout moves it.
3. Check that the window plugin's `decorate` (the window border) still paints nothing opaque over the content.

Patch GPUI Kit only if a release reverses the style order, paints an opaque layer in its window border, or dialog overlays need to treat the preview differently. In that case, vendor the smallest affected crate, point `[patch.crates-io]` at it, and record the upstream version, the diff and the license.

Known gaps before the Rust renderer can become the default:

- Parity is proven on NVIDIA only; Mesa is untested by decision.
- Not tested: Mesa, multiple outputs, mixed or fractional scales, display power-off, hotplug, Sway or KDE.
- Packaging still builds C++ unless `SCRNSVR_RENDERER=rust` is set, and `electron-builder` has not been exercised with the Rust binary.

### Milestone 3: Configuration and scene resolution

- `scrnsvr-core` reads the native XDG `scrnsvr/config.toml`. It defaults and diagnoses individual fields and reports malformed TOML separately. Saving syncs a same-directory temporary file, replaces the config atomically, and syncs the directory. A failed save leaves the caller's edits available for retry.
- [`data/catalog.json`](../data/catalog.json) contains 41 shader manifests and GLSL sources, 17 effects and their passes, 30 color schemes, and five color families. Core embeds the checked-in JSON with `include_str!`, and the settings spike uses its resolved default scenes. During the Electron overlap, `node scripts/export-rust-fixtures.cjs` refreshes the catalog and reference fixtures from TypeScript. Cargo needs only the checked-in data. Saved looks are user-defined snapshots in the TOML `presets` tables.
- The resolver preserves uniform normalization, palette precedence, custom GLSL wrapping, effect instance order, and rotation selection. Callers supply a random draw for rotation and a time with an explicit time zone for clock formatting. The optional `clock.pattern` replaces the time line and leaves the date under `clock.show_date`.
- `config.toml` uses snake_case keys (`global.idle_threshold_seconds`, `custom_shaders`, `effects.layers[].effect_id`) and drops the unused `kiosk` and `settings` fields. The parity test renames the TypeScript settings' camelCase field names before loading them; shader IDs, preset names and uniform names are left unchanged. The shared `data/catalog.json` keeps camelCase, since it is generated data rather than user-edited config.
- Direct unknown shader requests return the same error as TypeScript. Loading a stale configured shader warns and selects Flow Field. Stale rotation entries and unavailable effects are retained in configuration and skipped at resolution. Native scenes keep `uAudio` at zero. The custom wrapper supplies the uniform on demand, verified with a headless GLES render.
- Rust matched all 151 settings/reference pairs exported from the TypeScript main process: 142 scenes, six English UTC clock messages, two unknown-shader errors, and one empty rotation pick. The comparison covers every built-in with defaults and edited values, plus presets, palettes, custom sources, and effect stacks. Rust tests also check TOML round-trips, missing and malformed files, failed writes, and strftime formatting across a time-zone date boundary.
- Verification passed for `npm run test:rust` (48 tests, Clippy and rustfmt), `npm run typecheck`, `npx vitest run` (376 tests), and `npm run build:rust`.
- The native daemon and full settings editor still need to adopt the core API for startup, reload, debounced saves, and desktop color import.

### Not started

- Milestone 0 beyond the feature checklist and scene fixtures: frame captures and measured baselines.
- Keyboard, IME and accessibility checks for the subsurface preview (milestone 5).
- Milestones 4–6: the daemon, native settings, and packaging cutover.

## Technical references

- [Current native renderer design](decisions/0002-native-renderer.md)
- [glow context API](https://docs.rs/glow/latest/glow/struct.Context.html)
- [Smithay client toolkit shell abstractions](https://docs.rs/smithay-client-toolkit/latest/smithay_client_toolkit/shell/index.html)
- [Khronos EGL bindings](https://docs.rs/khronos-egl/latest/khronos_egl/)
- [GPUI Kit installation and dependency alignment](https://gpui-kit.com/docs/installation/)
- [GPUI Kit native component library](https://docs.rs/gpui-component/latest/gpui_component/)
- [GPUI Kit painting API](https://gpui-kit.com/docs/paint/)
- Shader and support crate documentation is linked at each recommendation in the shortlist above.
