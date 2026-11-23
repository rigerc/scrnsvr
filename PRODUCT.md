# Product

<!-- impeccable:product-schema 1 -->

## Platform

Linux desktop (native Rust app, GPUI settings window)

## Users

Linux desktop users choosing and previewing a screensaver shader in the settings window.

## Product Purpose

scrnsvr runs shader-based screensavers after desktop idle time. The settings window lets people explore a shader collection, preview a choice live, adjust its behavior, and save configuration locally. In this redesign, choosing and previewing shaders should be the easiest task.

## Positioning

The settings window connects a live OpenGL ES shader preview with direct controls for that shader, optional clock overlay, color schemes, saved looks for each visual, and a shuffle list.

## Operating Context

The product runs on Linux Wayland desktops with `wlr-layer-shell`. A native Rust app provides the settings window (GPUI), previews, thumbnails and the screensaver, which draws into layer-shell overlays. There is no idle daemon: Noctalia or hypridle runs `scrnsvr --open`. People use the settings window before the screensaver starts, and can open a shader in a windowed or fullscreen preview. The app can import desktop colors from Noctalia. Reactive audio was removed in 1.0.0.

## Capabilities and Constraints

- Keep existing shader selection, live preview, parameter controls, color schemes, Noctalia import, custom shader creation, presets, rotation, clock settings, and global display controls working. Audio response is gone; the three audio visuals render their quiet state.
- Preserve the current shader manifests and terminology. Configuration is `~/.config/scrnsvr/config.toml`; the 0.x `config.json` is not read.
- The settings interface is native Rust (GPUI Kit); live previews use the same OpenGL ES renderer as the saver.
- The current implementation and README are the source for feature behavior. Visual style is open to replacement.

## Evidence on Hand

- `crates/scrnsvr-settings/` contains the settings UI and its controls.
- `data/shaders/` contains the shader manifests and GLSL.
- `assets/screenshots/` contains captures of shader output.
- `README.md` documents the supported workflows and behavior.

## Product Principles

- Put the actual shader output at the center of choosing a shader.
- Make the selected shader and its available actions clear at a glance.
- Keep deeper configuration available without competing with discovery.
- Let users see changes immediately and know when they have been saved.
