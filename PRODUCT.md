# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Linux desktop users choosing and previewing a screensaver shader in the settings window.

## Product Purpose

scrnsvr runs shader-based screensavers after desktop idle time. The settings window lets people explore a shader collection, preview a choice live, adjust its behavior, and save configuration locally. In this redesign, choosing and previewing shaders should be the easiest task.

## Positioning

The settings window connects a live WebGL shader preview with direct controls for that shader, optional clock overlay, color schemes, saved looks for each visual, and a shuffle list.

## Operating Context

The product runs on Linux desktops as an Electron application. People use the settings window before the screensaver starts; the saver itself can launch fullscreen or in a windowed preview. The app may import desktop colors from Noctalia and may react to playing audio through PulseAudio or PipeWire-Pulse.

## Capabilities and Constraints

- Keep existing shader selection, live preview, parameter controls, color schemes, Noctalia import, custom shader creation, presets, rotation, clock settings, audio response, and global idle/display controls working.
- Preserve locally saved configuration and the current shader manifests and terminology.
- The settings interface is HTML, CSS, and TypeScript rendered by Electron; live previews use WebGL.
- The current implementation and README are the source for feature behavior. Visual style is open to replacement.

## Evidence on Hand

- `src/settings/` contains the settings UI and its controls.
- `src/renderer/shaders/` contains the shader manifests and rendering code.
- `assets/screenshots/` contains captures of shader output.
- `README.md` documents the supported workflows and behavior.

## Product Principles

- Put the actual shader output at the center of choosing a shader.
- Make the selected shader and its available actions clear at a glance.
- Keep deeper configuration available without competing with discovery.
- Let users see changes immediately and know when they have been saved.
