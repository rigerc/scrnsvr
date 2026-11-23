# ADR-002: Render the screensaver natively into layer-shell surfaces

> **Superseded by the native Rust app in 1.0.0** ([ADR-0003](0003-native-rust-app.md)). This record describes the C++ renderer and the Electron main process of the 0.x releases, which were removed at the 1.0.0 cutover. The presentation design below (layer-shell surfaces, EGL/GLES2, compositor-paced frames, one crossfade, input dismissal) carried over unchanged into `scrnsvr-renderer`, written in Rust. Paths and `npm` commands in this record refer to the removed code.

Status: Accepted. Date: 2026-11-13. Supersedes the presentation design in [ADR-001](0001-wlr-layer-shell.md).

## Context

ADR-001 kept rendering in Electron: an offscreen window drew the WebGL scene, and a Node-API module copied each frame into a `wlr-layer-shell` surface. On the development NVIDIA/Hyprland system, GPU texture export always failed, so every startup was torn down and recreated with bitmap frames. A 2560×1440 frame was then read back and copied through the CPU each frame (about 100% CPU). Each fix to that pipeline met another offscreen-rendering quirk. The last one: after the bitmap retry, Chromium ignored window transparency. Activation could therefore not fade from the desktop, and Hyprland's own layer animation added a fade to black before the app's fade from black: two fades.

## Decision

The screensaver is a standalone native program, `dist/native/scrnsvr-renderer` (`native/renderer/`). It creates one overlay-layer surface per selected output and renders the existing GLSL with OpenGL ES 2 through EGL directly into it. Electron keeps settings, gallery thumbnails, the windowed preview and the idle daemon. The native renderer is the only screensaver backend (see *Fallback removed* below).

The main process stays the source of truth for everything a scene needs. `src/main/native-renderer.ts` resolves presets, color schemes, uniform normalization, custom-shader wrapping, rotation picks, effect layers and clock text with the same TypeScript the Electron renderer uses. It streams the result as JSON lines on the renderer's stdin:

- `scene`: compiled fragment source, GL-ready uniform values, integrated-time and audio flags, and the active effect layers (all passes, history flag, resolved values)
- `clock`: style plus text already formatted with `Intl`, sent when the text changes
- `audio`: playback envelope frames while a reactive scene is on screen
- `dismiss`

The renderer prints `{"type":"ready"}` once every output has presented a frame. Exit codes before readiness (2 unavailable, 3 initial scene failed) are reported as launch errors.

### Presentation

- **Pacing:** frames are drawn only when the compositor has delivered the previous `wl_surface.frame` callback and the configured FPS interval has elapsed. `eglSwapInterval(0)` keeps swaps from blocking. A powered-off or hidden output delivers no callbacks, so it costs no rendering. Animation time skips gaps over about one second, as in the Electron runtime.
- **Activation and exit:** the surface uses premultiplied alpha. The first frame is fully transparent, and the scene's alpha rises over `fadeSeconds`, so the desktop crossfades straight into the scene. A compositor map animation multiplies into that one fade instead of adding a second. Dismissal fades the scene back out to the desktop, then exits. Once activation completes, an opaque region is set so the compositor can skip what lies beneath.
- **Rotation:** a black overlay rises over half the fade. At black the new scene is swapped in, then the overlay falls. A scene that fails to compile is skipped, and the current one keeps running. Picks arriving during the fade-out are coalesced.
- **Effects:** the WebGL effect stack's target ping-pong, multi-pass layers and history buffers are ported to GLES2 framebuffers.
- **Clock:** Pango/Cairo lays out the clock with the CSS overlay's proportions (size, margin, period and date scale, alignment, blurred shadow, opacity). The text texture is redrawn only when the text or output size changes.
- **Input:** a keypress, click, scroll, touch, or pointer travel beyond 12 logical pixels dismisses all outputs.

On Wayland, EGL can read compositor events into the default queue during `eglSwapBuffers` without dispatching them. The event loop therefore schedules again whenever `wl_display_prepare_read` finds queued events, instead of sleeping in `poll`.

## Consequences

- Rendering is no longer copied out of Chromium. On the development system, the full screensaver (Electron main process plus renderer) measured 1.2% CPU with an animated scene and clock, down from about 100%.
- GLSL must compile under the platform GLES driver as well as WebGL. `npm run check-native` compiles every built-in shader and effect pass with the native compiler. `--live` also checks on the real compositor that activation starts transparent, transitions swap behind black, broken scenes are skipped and dismissal restores the desktop.
- The native build needs `wayland-client`, `wayland-egl`, EGL, GLESv2 and `pangocairo` development files, plus `wayland-scanner`. Without them, `npm run build` continues so settings and previews work, but the screensaver cannot run. `npm run dist` requires the native build.
- Integer output scale determines buffer size, as before. Output hotplug or a scale change closes the screensaver, and the daemon reselects outputs on the next launch.
- Not yet verified on hardware: real display power-off (the frame-callback design covers it, but no DPMS test was run), multi-monitor and mixed-scale setups, and Mesa drivers.

## Fallback removed (2026-11-23)

The first version kept fullscreen Electron windows as an automatic fallback. A single failed native launch switched the daemon to that fallback until it restarted. Under Hyprland the fallback double-faded: the compositor's window animation faded the desktop into a black window, then the page faded from black into the scene. A 60 fps recording also showed the scene flashing at full strength before the black. The fallback and `--backend` were removed:

- `--open` and idle launches always use the native renderer. A failed launch is logged, and the next idle launch tries the native renderer again.
- Without `WAYLAND_DISPLAY` or a built renderer, `--open` exits with the reason, and `--daemon` exits with status 2. The systemd unit sets `RestartPreventExitStatus=2`.
- GNOME, X11 and other compositors without `wlr-layer-shell` are not supported for the screensaver. Settings and `--preview` still run there.
- The Electron renderer page now serves only the windowed preview and thumbnail capture. Its rotation, dismiss and rendering-activity IPC was removed.

## Vendored protocols

`native/protocols/wlr-layer-shell-unstable-v1.xml` and `xdg-shell.xml` remain as described in ADR-001. `xdg-shell` is generated only to resolve the layer-shell popup type reference. The `linux-dmabuf` protocol was removed along with the frame-copy pipeline.
