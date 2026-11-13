# Native Rust rewrite plan

Status: Proposed implementation plan. Updated: 2026-11-13.

Dependency evaluation completed for the current source baseline: see [executed checks, source findings, and adoption decisions](research/rust-rewrite-evaluation.md). Hyprsaver is a selective reference, `glsl` is the preferred optional AST tool, and stock GPUI's missing Linux external-surface API makes inline preview integration the first implementation gate.

## Goal and scope

Replace Electron/TypeScript and the C++ renderer with a fully native Rust application while preserving scrnsvr's existing shaders, configuration, and user workflows. The final settings UI must be native; retaining a web UI is not the target.

Use a staged migration. Keep the existing app usable until each Rust replacement passes its compatibility checks. Preserve GLSL and the GLES shader-rendering approach initially; changing the shader backend to Vulkan/wgpu is outside this rewrite. GPUI Kit's own UI rendering dependencies are separate from that decision.

The rewrite should consolidate rendering and behavior across settings previews, screensaver outputs, and thumbnail capture. Measure runtime and packaging improvements against the current native renderer, rather than assuming that changing language alone will improve performance.

## Current implementation and migration boundaries

- Electron owns the CLI, configuration, idle daemon, scene resolution, settings, previews, thumbnails, and fullscreen fallback: [`src/main/`](../src/main/) and [`src/settings/`](../src/settings/).
- The C++ renderer owns Wayland layer-shell surfaces, EGL/GLES rendering, effects, fades, clock composition, and dismissal: [`native/renderer/`](../native/renderer/).
- The existing boundary is JSON lines over child-process stdin/stdout. Messages include `scene`, `clock`, `audio`, and `dismiss`; readiness and exit codes control fallback: [`native-renderer.ts`](../src/main/native-renderer.ts).
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

Pinned-source evaluation has now confirmed that `gpui-pre` 0.3.12's public `surface`/`paint_surface` path only supports Apple CVPixelBuffers; `RenderImage` holds CPU image frames. Budget explicit Linux/wgpu renderer integration or another demonstrated native composition adapter. Stock surface painting is not a Linux EGL import solution. The settings application and adapter have not yet been compiled or demonstrated. [Evaluation evidence](research/rust-rewrite-evaluation.md#gpui-kit-selected-ui-unresolved-linux-gpu-embedding)

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
| [`winit`](https://docs.rs/winit/latest/winit/) + [`glutin`](https://docs.rs/glutin/latest/glutin/) | Evaluate as the standalone GLES fullscreen/windowed fallback adapter for Wayland and X11, separate from GPUI settings. Use compatible integration/raw-handle versions; prove output targeting and pacing before adoption. |
| [`pango`](https://docs.rs/pango/latest/pango/) + [`pangocairo`](https://docs.rs/pangocairo/latest/pangocairo/) | Retain current clock shaping/layout through Rust bindings. Upload only changed clock textures; this does not require a GTK settings UI. |
| [`image`](https://docs.rs/image/latest/image/) | PNG thumbnail/capture encoding and reference image loading. Enable only required codecs; no normal frame-by-frame saver readback. |

### Configuration, desktop integration, and maintenance

| Crate | Planned use and boundary |
| --- | --- |
| [`serde`](https://serde.rs/) + [`serde_json`](https://docs.rs/serde_json/latest/serde_json/) | Typed configuration/manifests and existing JSON-lines protocol. Explicit migrations and validation remain application code. |
| [`clap`](https://docs.rs/clap/latest/clap/) | Existing CLI flags/modes, backend enums, and generated help. Preserve established invocation behavior with fixtures instead of inheriting new parser defaults accidentally. |
| [`directories`](https://docs.rs/directories/latest/directories/) + [`tempfile`](https://docs.rs/tempfile/latest/tempfile/struct.NamedTempFile.html) | XDG base directories and same-directory temporary files persisted by atomic replacement. Assert the exact existing `scrnsvr/config.json` path; add flush/sync policy explicitly rather than assuming rename implies durable storage. |
| [`zbus`](https://docs.rs/zbus/latest/zbus/) | Direct logind session-property queries and suspend/resume signals, replacing `busctl` subprocesses when that adapter moves to Rust. Keep D-Bus work off the UI/render thread; do not add another async runtime without a demonstrated need. |
| [`x11rb`](https://docs.rs/x11rb/latest/x11rb/protocol/screensaver/index.html) | X11 ScreenSaver idle information and EWMH fullscreen properties. Use only for genuine X11 sessions; XWayland does not supply global Wayland idle/window state. |
| [`icu_datetime`](https://docs.rs/icu_datetime/latest/icu_datetime/) | Evaluate localized date/time formatting to replace Intl. Supply OS local-time/time-zone information separately and limit locale data to agreed requirements; verify formatting fixtures and package size. |
| [`thiserror`](https://docs.rs/thiserror/latest/thiserror/) + [`tracing`](https://docs.rs/tracing/latest/tracing/) | Typed core/platform failures and structured diagnostics for startup, backend selection, frame timing, and cleanup. Route renderer logs to stderr to preserve protocol stdout. |
| [`notify`](https://docs.rs/notify/latest/notify/) | Optional file watching only if live external-edit reload is retained/added deliberately. Watch the containing directory for atomic replacement; coalesce events. Not required for the existing reload-at-launch/rotation semantics. |

**Defer audio DSP changes.** [`rustfft`](https://docs.rs/rustfft/latest/rustfft/) could support richer spectral analysis later, but current [`AudioEnvelope`](../src/main/audio.ts) uses simple filters and RMS, not FFT. Port those calculations and the existing `parec` stream first; adding FFT or a new capture stack would change reactive shader behavior unnecessarily.

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

- Keep `$XDG_CONFIG_HOME/scrnsvr/config.json`, falling back to `~/.config/scrnsvr/config.json`.
- Preserve legacy `fps`/`monitor` migration, defaults, validation bounds, shader IDs, presets, custom sources, colors, effect instance IDs/order, rotation entries, and clock/audio settings.
- Serde deserialization must be followed by explicit validation; deriving defaults alone does not reproduce Zod behavior.
- Keep debounced atomic replacement, actionable save errors, and retry without losing edits. Back up configuration before the first Rust-written migration. Verify that a rollback build can read the result.
- Export favorites from the existing application before retiring Electron storage. Import them once into native UI preferences without attempting to parse Chromium's storage database directly.
- Convert manifests and generated palette/effect metadata to language-neutral data consumed by both implementations during migration. Preserve the GLSL sources and license records. The final build must not need Node to generate essential assets.

### Rendering and interaction

- Preserve all 41 current built-in shaders, custom-shader restrictions, normalized values, conservative randomization, parameter locks, and saved looks.
- Preserve the ordered effect stack, multipass bloom, per-instance temporal history, bypass behavior, failure recovery, and history reset/resource-release rules.
- Preserve speed-integrated animation, independent effect time, pause/redraw behavior, and suspension-gap handling.
- Keep the clock above effects, including position, font, shadow, opacity, date, and 12h/24h behavior. Test locale/time-zone formatting explicitly when replacing JavaScript Intl. Initially retain Pango/Cairo text layout through Rust bindings if it gives the closest parity.
- Keep transparent activation, configured fades, rotation through black, and the previous valid scene when a replacement fails to compile.
- Preserve keyboard, click, scroll, touch, and pointer-distance dismissal across the entire output group. Preserve hotplug/scale-change dismissal first; seamless reconfiguration is a separate enhancement.

### Desktop integration

- Keep existing CLI modes and backend selection, including argless settings, `--open`, `--daemon`, `--preview`, `--shader`, `--thumbnail`, `--output`, `--frames`, and `--backend auto|layer-shell|fullscreen`.
- Preserve native startup timeout, readiness, exit-code handling, explicit-backend errors, and automatic fallback after startup failure.
- Provide native fullscreen windows for GNOME/non-layer-shell Wayland and X11; do not make Hyprland or hypridle a runtime requirement.
- Preserve idle thresholds, one active saver group, resume suppression, audio/fullscreen inhibition, and opt-in playback capture.
- Initially retain `parec`/`pactl` and X11 inhibition helpers to avoid changing integration semantics simultaneously. Direct audio bindings can be a later improvement.
- Preserve the desktop entry and `scrnsvr.service` user service. Remove Electron-specific environment settings at final cutover.

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
- Prove native window creation and shader rendering on the planned fullscreen fallback platforms before settling the windowing adapter.

**Exit:** a demonstrated Rust saver and editable inline preview in GPUI Kit, documented GPU ownership/synchronization, a locked compatible dependency set, and recorded source-parser/windowing decisions. Verify the daemon/saver build does not depend on initializing GPUI/Vulkan. Prototype code is not feature parity.

### 2. Replace the production C++ renderer

- Complete the JSON-lines protocol, including clock/audio updates, readiness, startup errors, EOF, and dismissal.
- Port effects, timing, fades, rotation transitions, per-output resource ownership, input, and clock composition.
- Bound protocol input and pending work; coalesce superseded updates rather than growing an unbounded queue. Keep protocol output on stdout and diagnostics on stderr.
- Allow development builds to select C++ or Rust. Run the existing Electron orchestrator and native checks against Rust.

**Exit:** every shader/effect compiles; rendered parity and lifecycle checks pass; Rust can replace the native renderer while settings and orchestration remain unchanged. Keep C++ available for rollback.

### 3. Move configuration and scene resolution into Rust

- Implement core types, validation/migration, atomic persistence, manifests, palettes, preset resolution, rotation, and custom shader handling.
- Generate shared asset data for both Rust and TypeScript during the overlap period. Eliminate independently maintained copies of defaults and manifests.
- Compare Rust scene plans and configuration results with the baseline fixtures.
- Test missing, malformed, and unwritable configuration, unknown/stale shader references, and unavailable effect definitions.

**Exit:** core data parity and backward-compatible writes are demonstrated. The renderer still accepts the existing protocol; application behavior can move independently of GPU code.

### 4. Replace the daemon and launch orchestration

- Implement CLI dispatch, renderer supervision, configuration reload, rotation, startup fallback, and shutdown deadlines.
- Introduce explicit idle-provider capabilities using protocol bindings, `x11rb`, and a `zbus` logind adapter as appropriate. Validate units, monotonic timing, unavailable/stale data, and suspend/resume behavior. Keep unknown capability distinct from zero idle time internally.
- Replace Electron display selection. Define and test the policy for `primary` where the platform cannot report a primary output; expose the chosen output in diagnostics rather than silently claiming equivalence.
- Preserve audio subscription sharing, silence on failure, capture shutdown, and retry semantics.
- Log unavailable inhibition capabilities. Do not expand compositor-specific fullscreen detection as an implicit rewrite requirement.

**Exit:** Rust `--daemon` runs without GUI initialization or Electron; idle activation, dismissal, resume, and renderer crashes behave correctly. Manual launch remains available when idle capability is unavailable.

### 5. Complete native settings, previews, and fallback

- Implement settings in GPUI Kit: port shader discovery/search/favorites, live preview, manifest-driven Slider/NumberInput/ColorPicker/Select controls, advanced controls, locks, reset/randomize/undo, and saved looks.
- Port global effects, shuffle, clock controls, desktop colors/Noctalia import, global settings, and the custom-shader editor.
- Preserve save status/retry, focus after list edits, keyboard operation, reduced-motion startup behavior, and preview pause.
- Use Kit's native editor/input facilities for custom GLSL; add compatible Tree-sitter highlighting only if needed, and map driver diagnostics back to user source. Keep preview GPU work and background persistence out of UI callbacks.
- Implement native fullscreen fallback with the same shared renderer, group dismissal, and backend selection semantics.
- Implement thumbnail capture with deterministic render inputs. Use framebuffer readback only for explicit capture, not as the normal presentation pipeline.
- Export/import Electron-only preferences before removing the old UI.

**Exit:** the full application works without Electron, with all retained workflows checked against the baseline and design requirements in [DESIGN.md](../DESIGN.md).

### 6. Package, validate upgrades, and remove legacy code

- Produce native deb and AppImage artifacts with the existing desktop/service identity. Choose and document the supported distribution and GL/runtime baseline.
- Add Rust formatting, Clippy, unit/contract tests, shader compilation, rendering checks, and package smoke checks to the build workflow.
- Verify clean installation, upgrade with existing configuration, service restart/uninstall behavior, and rollback to the previous release.
- Remove Electron/TypeScript runtime code, C++ renderer, obsolete generators, npm runtime/build requirements, and electron-builder only after their replacements pass.
- Update README, build instructions, dependency/license notices, and architecture documentation to describe the shipped app.

**Exit:** native release artifacts pass the release matrix, legacy configuration survives upgrade/rollback, and no Electron, Node, or application-owned C++ component is needed to build or run the final app. Native system libraries remain allowed.

## Verification and release gates

Use existing tests as behavioral evidence, then port meaningful cases as ownership moves. Start with `tests/config.test.ts`, `tests/native-renderer.test.ts`, daemon/audio suites, runtime/effects suites, and the settings interaction suites. Adapt `scripts/check-native.cjs` during the overlap, then replace its Node harness before final removal.

Required checks before cutover:

- Exact comparisons for normalized configuration, scene plans, shader/effect metadata, and deterministic state transitions.
- GPU checks for all shader/effect programs, representative fixed-time output, multipass/history behavior, transparent activation, fades, failed-scene recovery, and clock composition. Set image tolerances per driver and record why differences are acceptable.
- Lifecycle checks for partial startup failure, startup timeout, stdin closure, signals, daemon stop, stopped callbacks, display power-off, unplug, scale changes, and cleanup of input grabs/cursors/processes/resources.
- Desktop checks on Hyprland and Sway layer-shell, GNOME native fullscreen fallback, and X11; test KDE where supported and record results separately.
- Hardware checks on NVIDIA and Mesa, multiple outputs, mixed scales, fractional scales, differing refresh rates, and actual display power-off/resume. Report untested combinations explicitly.
- Native UI checks for keyboard-only operation, focus, IME/clipboard, accessibility support, high DPI, resizing, paused edits, malformed custom shaders, and failed saves/retry.
- GPUI/GLES interop checks for image/surface release, synchronization, preview clipping and overlays, resize/scale changes, repeated preview replacement, and unavailable GPU capabilities. Confirm closing settings frees its GPU resources and the independent daemon/saver continues working.
- Performance comparison using identical scenes, resolution, FPS, effects, and hardware. Require no unexplained sustained CPU/GPU or memory regression; confirm rendering stops for outputs without callbacks and resources stabilize across repeated activation.

Keep packaged Rust builds opt-in until these gates pass. Do not delete rollback implementations merely because a milestone has started.

## Open decisions and boundaries

- Settings toolkit is decided: GPUI Kit. Open: the tested GPU preview adapter and any narrowly scoped upstream integration required for inline GLES output.
- Native saver/fallback window adapter and minimum supported Linux/GPUI dependencies: resolve with the spike and packaging baseline; keep settings dependencies isolated.
- Shader source tooling: `glsl` is preferred for optional inspection; direct source handling and GLES compilation remain authoritative. Open: any corrected editor highlighting grammar, not a change to the supported GLSL ES dialect.
- Reliable idle-provider coverage and primary-output selection across supported desktops: resolve before daemon cutover.
- Locale formatting replacement for Intl and acceptable cross-platform font differences: resolve before UI parity sign-off.
- Fractional scaling: evaluate upstream support early; retain current behavior until a tested replacement is available, then document any deliberate improvement.

No implementation-time estimate is committed before the rendering/UI spike establishes the reuse boundary. Keep each milestone reviewable and independently reversible. The first implementation task is milestone 0, followed by the Rust saver/native-preview spike.

## Technical references

- [Current native renderer design](decisions/0002-native-renderer.md)
- [glow context API](https://docs.rs/glow/latest/glow/struct.Context.html)
- [Smithay client toolkit shell abstractions](https://docs.rs/smithay-client-toolkit/latest/smithay_client_toolkit/shell/index.html)
- [Khronos EGL bindings](https://docs.rs/khronos-egl/latest/khronos_egl/)
- [GPUI Kit installation and dependency alignment](https://gpui-kit.com/docs/installation/)
- [GPUI Kit native component library](https://docs.rs/gpui-component/latest/gpui_component/)
- [GPUI Kit painting API](https://gpui-kit.com/docs/paint/)
- Shader and support crate documentation is linked at each recommendation in the shortlist above.
