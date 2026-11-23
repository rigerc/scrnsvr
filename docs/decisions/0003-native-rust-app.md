# ADR-0003: One native Rust app replaces Electron and the C++ renderer

Status: Accepted. Date: 2026-11-23. Ships in 1.0.0. Supersedes [ADR-002](0002-native-renderer.md) and, through it, [ADR-001](0001-wlr-layer-shell.md). The full plan, evidence and milestone history are in [rust-rewrite-plan.md](../rust-rewrite-plan.md).

## Context

Through 0.10.0, scrnsvr was an Electron/TypeScript app (settings, previews, thumbnails, idle daemon, scene resolution) that drove a separate C++ program for the screensaver itself. Since ADR-002 the screensaver was already native, so Electron remained only for the settings window, previews and orchestration, at the cost of an Electron runtime and a Node build. Two toolchains also meant two implementations of scene logic, kept in step by exported fixtures.

## Decision

Ship one native Rust app, built from a Cargo workspace, with no Electron, TypeScript, Node or C++ at build or run time.

### Architecture

| Crate | Role |
| --- | --- |
| `scrnsvr-core` | Configuration (TOML, validated, atomic saves), the built-in catalog, scene resolution (presets, palettes, effect stacks, rotation, custom-shader wrapping), clock formatting, the renderer JSON-lines protocol, the `noctalia msg` client, thumbnails. No windowing or GL. |
| `scrnsvr-render` | GLES2 renderer on `glow`: programs, uniforms, ordered effect passes and temporal history, fades, the Pango/Cairo clock. Draws into whatever context is current, so one renderer serves layer-shell surfaces, headless pbuffers (thumbnails, tests) and the settings preview. |
| `scrnsvr-platform` | Dynamically loaded EGL and wlr-layer-shell outputs, seats and frame callbacks (smithay-client-toolkit), the preview window. |
| `scrnsvr-app` | `scrnsvr` (CLI, saver supervision, `--install`, `--setup-noctalia`, preview, thumbnails) and `scrnsvr-renderer` (the saver process). No GPUI dependency. |
| `scrnsvr-settings` | `scrnsvr-settings`: the GPUI Kit settings app on GPUI-free models, with an inline GLES preview. |

The saver stays a separate child process of `scrnsvr`, speaking the same JSON-lines protocol as in ADR-002, so a rendering failure cannot take down a caller and the saver never loads GPUI or Vulkan. Configuration is written only by the settings app; the saver consumes resolved scenes.

The AppImage holds the three binaries (`scrnsvr`, `scrnsvr-renderer`, `scrnsvr-settings`). `AppRun` is a symlink to `scrnsvr`, so the others are found next to it.

### Built-in assets without Node

The shader and effect GLSL, their manifests and the color schemes are plain files under `data/`. `crates/scrnsvr-core/build.rs` assembles them into the in-memory `Catalog` at compile time. A test checks the result against a frozen copy of the catalog the last TypeScript release produced, and headless GPU tests compile every built-in shader and effect.

### Settings preview

GPUI cannot import an external EGL texture on Linux. The settings preview is therefore a Wayland subsurface below a transparent GPUI window, with its own EGL context and the shared renderer. The compositor composites it; nothing is read back and GPUI is not forked. The settings app requires Wayland and Vulkan.

### Product decisions

Agreed with the maintainer on 2026-11-23:

- **Supported desktop:** Hyprland. Other wlr-layer-shell compositors may work and are not promised. Tested on one NVIDIA machine with one output; Mesa, multiple outputs and fractional scales are documented as untested.
- **Fresh start:** settings are `$XDG_CONFIG_HOME/scrnsvr/config.toml`. The Electron `config.json`, legacy fields and favorites are neither read nor migrated. Favorites live in `ui.toml` under the XDG state directory.
- **Reactive audio dropped:** no `parec`/`pactl` capture and no audio settings. `uAudio` is always zero, so the three audio visuals keep their quiet state, and custom shaders that declare it still compile.
- **No built-in idle daemon:** Noctalia's idle service or hypridle runs `scrnsvr --open`, which is single-instance (exclusive lock; a second trigger exits 0) with `--dismiss` to close it. `scrnsvr --daemon` exits 2 with a pointer to those. Inhibition (fullscreen video, browsers) is left to the idle service. `--setup-noctalia` configures Noctalia through `noctalia msg config-set` only, dry run by default, and sets its pre-action fade to 0 so only scrnsvr fades.
- **Clock:** fixed English default formats with 12h/24h, plus an optional strftime pattern. No locale data.
- **Packaging:** AppImage only (no `.deb`, no systemd unit). The release build runs in an Ubuntu 22.04 container so it needs glibc 2.35. A stable `~/.local/bin/scrnsvr` link comes from `--install`.
- **Settings scope:** everything the Electron settings had, except audio.

## Consequences

- One language, one toolchain (`cargo`), one place for scene logic. `scripts/check.sh` runs tests, Clippy and rustfmt; GPU tests skip without EGL.
- Test fixtures exported from TypeScript (`messages.jsonl`, `scene-parity.jsonl`, `catalog.json`) are frozen references from v0.10.0. They are not regenerated; deliberate changes to built-ins or scene semantics update them by hand.
- The saver depends on host libraries (pango, cairo, glib, fontconfig, Wayland, EGL), and the settings app also on Vulkan and X11 client libraries that GPUI links. The AppImage does not bundle them.
- Parity with the C++ renderer was bit-identical on NVIDIA (all 60 captured frames); it is not asserted on other drivers.
- Upgrading GPUI Kit needs the checks recorded in the plan (window-background test, preview smoke).
