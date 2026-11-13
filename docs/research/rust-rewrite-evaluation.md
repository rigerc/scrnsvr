# Rust rewrite dependency evaluation

Evaluated: 2026-11-13. Project baseline: `9e1537f78c4ea0a862c1bdf07a4736e76cddad42`.

## Recommendation

Build scrnsvr's Rust implementation around `glow`, EGL, Smithay client toolkit, and calloop. Use GPUI Kit for settings as decided, but treat inline GLES presentation as a separate integration project. Reuse selected hyprsaver platform ideas rather than forking its whole application. Prefer `glsl` for optional AST inspection; keep the actual GLES compiler responsible for shader compatibility and application code responsible for custom-shader policy.

This evaluation includes executed tests and pinned-source inspection. It does **not** demonstrate a working GPUI settings window, zero-copy preview embedding, multi-monitor handling, display power-off behavior, or full Rust feature parity.

## Evidence collected

- Downloaded the published hyprsaver 0.4.8 source package, corresponding to upstream commit `f33a4fdf46f9fe9e96db465480f32e3e04ab1c42`.
- Built it and ran `cargo test --locked`: **153 passed, 0 failed**. These are upstream unit tests, not compositor/hardware tests.
- Ran its headless `render-preview julia --duration 1 --resolution 64x64 --fps 2 --seed 0`: produced a WebP successfully without displaying a screensaver. No performance comparison is inferred from this small smoke test.
- Built a parser harness with `glsl = 7.0.0`, `glsl-lang = 0.8.1`, `tree-sitter = 0.26.13`, and `tree-sitter-glsl = 0.2.0`.
- Exported scene sources through the existing `scripts/lib/native-scenes.ts` entry and `buildScenePlan`, rather than approximating the current GLSL wrapper. Tested 41 raw built-ins, their 41 production wrappers, 20 effect programs/passes, and 8 diagnostic/policy probes.
- Ran the existing native renderer's `--compile-check` against the 61 production shader/effect programs and 8 probes. This checks fragment compilation/linking in its headless context; it is not a visual equivalence test.
- Compiled an isolated current Wayland/GLES dependency group with `cargo check`; `cargo tree --duplicates` reported no duplicate package versions in that group.
- Inspected published GPUI Kit 0.9.1, gpui-component 0.9.1, and its pinned `gpui-pre`, platform, Linux, and wgpu 0.3.12 source packages. GPUI identifies its underlying Zed revision as `d2a4fb6ded7c470be25d1541281da3882495b65b`.

Toolchain: rustc/cargo 1.99.1 on this Linux workspace. Scratch projects, downloaded packages, locks, corpus, raw results, and logs are under `/tmp/scrnsvr-rust-eval/`; no production Cargo workspace or Electron dependency was added. The temporary artifacts are not permanent repository fixtures.

## Hyprsaver: useful reference, unsuitable as the application base

**Verdict: selectively adapt platform/headless patterns; do not fork the whole application or depend on it as a library.** Its published manifest contains a binary target, not a reusable library interface. The source is MIT licensed; retain notices and upstream provenance for any code actually extracted. [Published package and source](https://docs.rs/crate/hyprsaver/0.4.8/source/), [license](https://docs.rs/crate/hyprsaver/0.4.8/source/LICENSE)

### Reuse candidates

- `wayland.rs`: output/seat/layer-shell bindings, per-output EGL ownership, fractional scale plus viewport handling, and hiding the pointer using its enter serial. Adapt these patterns behind scrnsvr's own lifecycle interface rather than importing the entire state object, which also owns upstream configuration, shader, palette, and cycling state.
- `egl.rs`: dynamic EGL loading and display/config selection. Change context/config requirements to preserve scrnsvr's supported GLES shader path.
- `headless_egl.rs`: separate headless context ownership with surfaceless/pbuffer alternatives. The successful WebP smoke test confirms this path works here, not that every target driver supports its default-display acquisition strategy.
- `main.rs`: graceful signal handling with a separate hard-exit watchdog is worth retaining as a design pattern. Prefer scrnsvr's parent-process shutdown deadline as the primary recovery mechanism; do not import PID-file management unnecessarily.

Pinned source: [Wayland](https://github.com/maravexa/hyprsaver/blob/f33a4fdf46f9fe9e96db465480f32e3e04ab1c42/src/wayland.rs), [EGL](https://github.com/maravexa/hyprsaver/blob/f33a4fdf46f9fe9e96db465480f32e3e04ab1c42/src/egl.rs), [headless EGL](https://github.com/maravexa/hyprsaver/blob/f33a4fdf46f9fe9e96db465480f32e3e04ab1c42/src/headless_egl.rs), [shutdown](https://github.com/maravexa/hyprsaver/blob/f33a4fdf46f9fe9e96db465480f32e3e04ab1c42/src/main.rs).

### Behavior that must not be copied unchanged

- **Shader ABI:** `egl.rs` selects an ES3 configuration and its Wayland contexts request major version 3. `prepare_shader` defaults to `#version 320 es`, introduces its own uniforms and palette LUTs, and rewrites entry points. scrnsvr's existing shaders/effects use the GLES2/GLSL ES 1.00 path with `uTime`, `uResolution`, `gl_FragColor`, manifest values, and our own wrapping. Keep our source preparation and manifest-driven uniform upload. [Shader preparation](https://github.com/maravexa/hyprsaver/blob/f33a4fdf46f9fe9e96db465480f32e3e04ab1c42/src/shaders.rs), [current ABI](../../src/shared/shader-source.ts)
- **Suspension and pacing:** `FRAME_CALLBACK_TIMEOUT` is one second. `wants_frame` allows drawing again after that timeout even without a callback; a repeating FPS timer continues dispatching. This intentionally retries stalled outputs and differs from scrnsvr's callback-only drawing. Retain callback suspension, independent shutdown deadlines, and accurate FPS scheduling; do not adopt the timer or one-second rendering retry unchanged. [Wayland pacing](https://github.com/maravexa/hyprsaver/blob/f33a4fdf46f9fe9e96db465480f32e3e04ab1c42/src/wayland.rs)
- **Renderer policy:** fixed `UniformLocations`, palette transitions, shader-level feedback, and wall-clock time do not replace arbitrary manifest controls, the ordered effect stack with per-instance history, clock composition, audio frames, and scrnsvr's integrated animation phase. Its FBO helpers are reference material; port our existing scene/effect logic. [Renderer](https://github.com/maravexa/hyprsaver/blob/f33a4fdf46f9fe9e96db465480f32e3e04ab1c42/src/renderer.rs)
- **Application/UI:** TOML configuration, CLI/presets/playlists, PID-file behavior, and the egui editor are application-specific. Its preview connects to Wayland and creates an XDG window; it is not evidence of an X11 fallback. It relies on external idle orchestration rather than providing scrnsvr's daemon/inhibition contract. Retain scrnsvr's JSON/CLI semantics and GPUI settings. [Entry point](https://github.com/maravexa/hyprsaver/blob/f33a4fdf46f9fe9e96db465480f32e3e04ab1c42/src/main.rs), [preview](https://github.com/maravexa/hyprsaver/blob/f33a4fdf46f9fe9e96db465480f32e3e04ab1c42/src/preview.rs)

Hyprsaver's locked toolkit versions are SCTK 0.19.2, calloop 0.13.0, and glow 0.14.2. Extraction into the checked current group below requires API adaptation; copying its dependency versions would create an unnecessary second generation of platform types.

## Shader tooling: executed corpus results

The production set contains **61 programs: 41 wrapped built-ins and 20 effect programs/passes**. The 41 raw built-in sources were tested separately and are not another 41 distinct visuals.

| Implementation | Wrapped built-ins | Effect programs | Raw built-ins | Decision |
| --- | --- | --- | --- | --- |
| `glsl` 7.0.0 | 41/41 parsed | 20/20 parsed | 41/41 parsed | Preferred optional AST tool |
| `glsl-lang` 0.8.1, default options | 41/41 parsed | 19/20 parsed | 41/41 parsed | Do not use as an acceptance gate |
| `glsl-lang` 0.8.1, `default_version: 100` | 41/41 parsed | 19/20 parsed | 41/41 parsed | Version option did not resolve mismatch |
| `tree-sitter-glsl` 0.2.0 with Tree-sitter 0.26.13 | 0/41 without recovery errors | 0/20 without recovery errors | 0/41 without recovery errors | Defer unmodified grammar |
| Existing native GLES compile/link check | 41/41 compiled | 20/20 compiled | Not run unwrapped | Preserve as compatibility authority |

### What the failures mean

`glsl-lang` rejects `active` at byte range 960..966 of `digital-glitch.glsl`, classifying the name as a reserved keyword. A minimal `float active = 1.0;` probe reproduces it, while this workspace's GLES driver accepts both that probe and the complete existing effect. This is a concrete parser/driver acceptance mismatch; it is not a claim that every driver or GLSL dialect permits that identifier. The `glsl-lang` lexer family cannot be presumed to solve it without separate evidence. [Existing effect](../../src/renderer/effects/digital-glitch.glsl), [parser](https://docs.rs/glsl-lang/0.8.1/glsl_lang/)

The Tree-sitter language ABI and its highlight query load successfully. However, a minimal `precision highp float;` declaration produces a recovery tree with a missing identifier, and every current built-in/effect contains recovery errors. Recovery trees may still provide partial highlighting; zero clean parses does not mean the editor cannot display or color the source. It does mean this version is unsuitable for acceptance diagnostics and requires grammar work or a different highlighting strategy before adoption. GPUI Component 0.9.1 uses Tree-sitter 0.26.13 and exposes `LanguageRegistry::register` for custom grammars; there is an integration point, but grammar compatibility remains a separate issue. [Grammar](https://docs.rs/tree-sitter-glsl/0.2.0/tree_sitter_glsl/), [GPUI registry source](https://docs.rs/crate/gpui-component/0.9.1/source/src/highlighter/registry.rs)

Both AST parsers reject the deliberately malformed missing-semicolon probe, but both accept an undefined-variable probe that the driver rejects. They also accept a sampler declaration that the GLES compiler accepts but scrnsvr's custom-shader policy forbids. Therefore the three responsibilities remain separate: AST/token inspection, application policy, and driver compilation/linking. Parsing cannot replace either of the other two. All eight probes behaved as recorded in the scratch JSON results; driver checks produced exactly the two intentional syntax/semantic failures.

**Adoption:** use `glsl` only where structural inspection improves the existing source handling. Preserve original source, retain driver diagnostics and the previous valid scene, and allow a compatible fallback if optional AST tooling cannot handle a source. Do not round-trip every program through an AST printer. `glsl` and `glsl-lang` both carry BSD-3-Clause licenses; add the selected license notice. No shaderc/Naga dependency is needed for this GLES migration. [glsl API and documented dialect](https://docs.rs/glsl/7.0.0/glsl/)

## GPUI Kit: selected UI, unresolved Linux GPU embedding

**Verdict: retain GPUI Kit 0.9.1 for settings; make the Linux preview adapter the first integration task.** Source inspection is materially stronger than assuming the documented paint/canvas API accepts external textures.

- Kit pins `gpui-pre = 0.3.12` and a matching desktop platform family, while re-exporting components and assets. Use its facade and aligned versions. `tree-sitter` is an optional Kit feature; do not enable the entire language collection for GLSL editing.
- In pinned `gpui-pre` source, `SurfaceSource` only has an Apple `CVPixelBuffer` variant. The `surface` constructor and `Window::paint_surface` are gated to macOS/iOS. There is no Linux EGL/DMA-BUF variant of that public surface API.
- `RenderImage` stores CPU-side image frames. It is appropriate for static thumbnails, but converting every GLES preview frame to it would introduce readback/upload rather than prove shared-GPU presentation.
- Pinned Linux GPUI routes rendering through `gpui-pre-wgpu`. Its Wayland DMA-BUF code inspected here probes compositor GPU identity; that is not an application-facing external-texture import API. Native UI and GLES rendering remain different ownership/synchronization paths.

Sources: [Kit manifest](https://docs.rs/crate/gpui-kit/0.9.1/source/Cargo.toml), [surface element](https://docs.rs/crate/gpui-pre/0.3.12/source/src/elements/surface.rs), [window painting](https://docs.rs/crate/gpui-pre/0.3.12/source/src/window.rs), [image storage](https://docs.rs/crate/gpui-pre/0.3.12/source/src/assets.rs), [Linux manifest](https://docs.rs/crate/gpui-pre-linux/0.3.12/source/Cargo.toml).

Consequently, inline preview with no continuous CPU readback is **not available through the inspected stock public surface API**. Budget for an external-image presentation extension to the pinned Linux/wgpu renderer, or another proven native composition adapter. Scope it before committing the full settings port: external allocation/import, format/modifier agreement, fences, release, resize, clipping, stacking, GPU mismatch, and device loss. A separate GLES preview window is a development aid, not completion of inline-preview parity. Do not change the user-selected toolkit or silently port all shaders to WGSL to avoid the integration work.

No GPUI application was compiled or displayed in this evaluation, and no GPU-sharing adapter was implemented. GPUI Fast was not evaluated as an alternative. These findings concern the inspected default pinned backend.

## Rendering/platform group: compile-checked recommendation

An isolated Cargo project imports each crate below and passes `cargo check`. The resolved project has one version per package according to `cargo tree --duplicates`; this does not establish runtime interoperability with GPUI or source compatibility with hyprsaver.

| Crate | Checked version | Decision |
| --- | --- | --- |
| `glow` | 0.18.0 | Adopt GLES API and driver reflection |
| `khronos-egl` | 6.0.0, `dynamic` | Adopt for standalone EGL ownership |
| `wayland-egl` | 0.32.11 | Adopt for Wayland EGL windows |
| `smithay-client-toolkit` | 0.21.1 | Adopt platform abstractions; adapt upstream examples |
| `calloop` | 0.14.5 | Adopt saver/platform event loop |
| `calloop-wayland-source` | 0.4.1 | Adopt event-queue integration |
| `wayland-client` | 0.31.15 | Use with the checked toolkit family |
| `wayland-protocols` | 0.32.13, `client,staging` | Adopt required capability bindings |
| `wayland-protocols-wlr` | 0.3.12, `client` | Adopt where direct wlr bindings are needed |

SCTK 0.21.1 requires `wayland-client ^0.31.14`; an initial exact 0.31.11 pin failed resolution. Do not turn an older upstream manifest's semver minimum into an exact pin when assembling this group. Pin/lock the group as a unit and review upgrades together.

Keep this event loop in the saver/platform process. GPUI manages its own UI loop. Do not nest a blocking calloop dispatch inside a GPUI callback or add Tokio solely to coordinate the two processes.

## Other shortlisted crates: scoped decisions

These decisions are based on API/source review and the existing app's requirements, **not** successful integration tests for each row.

| Crates | Decision and remaining check |
| --- | --- |
| `serde` / `serde_json` | Adopt typed configuration and JSON-lines messages; port Zod migration/bounds explicitly. Test unknown keys, defaults, malformed values, and rollback. |
| `clap` | Adopt CLI parsing with compatibility fixtures. Its default strictness must not unintentionally redefine existing invocations. |
| `directories` / `tempfile` | Adopt for XDG base paths and same-directory temporary writes. Assert the exact legacy path and specify flush/sync behavior separately. |
| `thiserror` / `tracing` | Adopt errors and diagnostics. Keep protocol stdout clean and logging off the render hot path where possible. |
| `zbus` | Adopt direct logind queries/resume signals when replacing the daemon; choose runtime/features deliberately and test unavailable/stale properties. Not a cross-desktop idle solution by itself. |
| `x11rb` | Adopt X11 idle/EWMH adapter; cannot infer native Wayland state from XWayland. |
| `pango` / `pangocairo` | Retain clock shaping through bindings; texture/layout parity and font fallback still need testing. This does not imply a GTK UI. |
| `image` | Adopt minimal required codecs for capture/static thumbnails. Hyprsaver's WebP export does not make animated WebP a requirement for scrnsvr. |
| `winit` / `glutin` | Conditional: prove standalone Wayland/X11 fullscreen targeting, input dismissal, and EGL compatibility. Hyprsaver's direct-Wayland preview is not that proof. |
| `icu_datetime` | Conditional: locale parity, OS time-zone input, calendar requirements, and data/package cost remain untested. Do not promise Intl-equivalent output merely by choosing ICU4X. |
| `notify` | Defer unless external file watching becomes a requirement; current reload-at-launch/rotation does not require it. |
| `rustfft` | Defer: port the current filter/RMS envelopes first. FFT would change reactive behavior rather than implement parity. |
| `shaderc` / `naga` | Defer shader compiler/translation changes. GPUI's internal wgpu dependency does not require moving scrnsvr's shader ABI. |

Primary API references for these rows are linked in the [rewrite plan's crate shortlist](../rust-rewrite-plan.md#crate-shortlist-and-adoption-policy).

## Changes to implementation order

1. Keep baseline fixtures and the current C++ renderer as the reference.
2. Use the checked modern platform group and port scrnsvr's scene/effect behavior; extract only narrow hyprsaver patterns with retained license notices.
3. Prove a real GPUI-to-GLES inline presentation adapter before expanding the settings port. Its absence is an identified integration gap, not an unspecified toolkit choice.
4. Add `glsl` only where structural inspection is needed. Defer `glsl-lang` and the unmodified Tree-sitter GLSL grammar; preserve GLES compilation and custom-source policy tests.
5. Port persistence, daemon, clock, and audio behavior without adding optional watching, spectral analysis, or shader translation.

## Artifact provenance

SHA-256 of published packages inspected:

- hyprsaver 0.4.8: `d7ea7668056a6c849d34b6f9d4825207dca5bcd9967065157aac5a330c915742`
- gpui-kit 0.9.1: `aca1dedfea73645b60b5893c9c16de0b1396f2cf4251d19e5f03a295c1b61879`
- gpui-pre 0.3.12: `29db89613527079737f53752eab27fb65c9a7dd94979256c65a0e590c9fd34d8`

Source packages were fetched from `static.crates.io`; versioned source links above identify the corresponding published content. Compilation checks and the headless smoke test ran locally. Neither passing unit tests nor successful source parsing establishes graphics correctness on the release hardware matrix.
