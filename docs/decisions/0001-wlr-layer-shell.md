# ADR-001: Native Wayland presentation for the screensaver

Status: Superseded by [ADR-002](0002-native-renderer.md) (native rendering). Surface placement, input and output selection carried over. Date: 2026-11-01.

## Context

Electron's fullscreen windows leave placement and stacking to the compositor. A screensaver on layer-shell compositors needs explicit output selection, coverage above fullscreen applications and panels, and keyboard/pointer dismissal. Existing shaders, settings, audio IPC, clock, rotation and fades should continue to run in Electron.

## Decision

Use a small Node-API host in `native/layer-shell.cc` to create independent `wlr-layer-shell` surfaces. Electron renders offscreen. One surface per selected output uses the overlay layer, all four anchors, exclusive zone `-1`, and exclusive keyboard interactivity. The compositor supplies logical dimensions; integer output scale determines buffer pixel dimensions. Fractional-scale outputs use the compositor's integer buffer scale, which can oversample. Output topology or scale changes close the entire group so the next launch rediscovers outputs.

The host integrates its connection with Electron's libuv loop. Discovery has a bounded timeout. Wayland listeners defer JavaScript notifications through a Node-API thread-safe function so cleanup cannot reenter Wayland dispatch. Protocol disconnects and renderer crashes tear down the group.

Prefer Electron's single-plane RGBA/BGRA DMA-BUF textures when the compositor advertises the exact format/modifier. Use asynchronous buffer creation so an unsupported import can fail without terminating the connection. Keep each Electron texture leased until `wl_buffer.release`. Limit each renderer to two outstanding frames. If GPU export fails at startup, recreate the offscreen renderers with Electron's bitmap producer; if an individual import fails, use paced readback. Bitmap frames are copied into bounded, compositor-owned SHM buffers and released on the same protocol event.

Native input sends a dismissal notification to every renderer through the preload bridge. Each renderer completes its fade before requesting close. Close is deferred while the native host commits an opaque black SHM buffer for that output and waits for its frame callback; further submissions and late DMA-BUF imports cannot replace that buffer. Once every output has completed this step, the group is destroyed. A six-second deadline removes the surfaces if renderers or final-frame callbacks stop responding. Pointer movement uses a 12-logical-pixel threshold and the pointer is hidden over the surfaces.

`--backend auto` attempts this on Linux with `WAYLAND_DISPLAY`; startup failure falls back to the existing fullscreen windows. `layer-shell` requires native presentation and reports startup failure. `fullscreen` bypasses native presentation. Settings, previews and thumbnail capture keep their existing paths. Native compilation is optional during ordinary builds; `build:layer-shell` requires it. Packaged `.node` files are unpacked from ASAR. The module uses Electron's Node-API and libuv exports and the system Wayland client library.

## Alternatives

- Use `@covas-labs/electron-overlay`: its experimental layer-shell implementation owns an independent surface and supports DMA-BUF, but documents no keyboard focus and an empty input region. A screensaver requires native input, so using it unchanged would leave dismissal unsupported. [Package documentation](https://github.com/COVAS-Labs/electron-overlay/blob/main/packages/electron-overlay/README.md#experimental-layer-shell-surface).
- Replace the renderer with GTK/WebKit or native GL: this would require broader renderer integration and diverge from the existing WebGL runtime.
- Reassign Electron's surface role: the layer-shell protocol rejects surfaces already assigned another role, so the host must own its surfaces. [Protocol](https://github.com/swaywm/wlr-protocols/blob/master/unstable/wlr-layer-shell-unstable-v1.xml).

## Verification and limits

Unit tests cover selection, modifier precision, texture leases, bounded submissions, startup cleanup, input shutdown, hotplug, and GPU import fallback. `scripts/check-layer-shell.cjs` exercises the real compositor and production renderer/preload, checks shader pixels, continuous presentation, frame release, and teardown. `--shm` forces bitmap frames; `--input` also checks pointer dismissal through Hyprland 0.55+ and restores the cursor. These checks briefly cover the primary display.

`--cycle` uses bitmap frames to check shader transitions through black, recovery from a broken custom shader, and subsequent swaps by sampling the pixels submitted to Wayland. Transition regression tests also cover overlapping picks, mount cleanup, retry after failure, and excluding the initial selection from the first scheduled cycle.

On the development NVIDIA/Hyprland system, shared-texture export fails and automatic retry with bitmap frames works. DMA-BUF presentation remains driver dependent; it needs hardware verification on a driver that exports compatible textures. Bitmap frames preserve GPU shader rendering but incur CPU readback and copy costs. Actual mixed-scale and multi-monitor hardware still need verification beyond the lifecycle unit tests.

Layer-shell supplies desktop overlay behavior, not session locking or authentication. Idle detection is unchanged.

## Display power-off and rendering suspension

Normal commits request one `wl_surface.frame` callback per output. The host rejects further frames until that callback arrives; buffer release remains a separate texture-ownership signal. The existing `presented` event means a buffer was committed, not that it reached the physical display.

If a callback remains outstanding for one second, the main process stops offscreen painting and capture for that output and sends a cached preload activity update. The renderer cancels its shader/effect loop, unsubscribes from reactive audio, suppresses resize redraws, cancels in-flight fades, and defers shader cycling until the output resumes. The outstanding native callback remains alive so the compositor can wake the renderer. Resume starts a fresh animation epoch and applies the latest deferred cycle using current configuration. Other outputs continue independently.

Dismissal skips final-frame waits for suspended outputs. Visible outputs still finish their black transition; the group shutdown deadline remains a fallback for an unresponsive renderer or compositor. Native callbacks, stall timers and texture leases are cleaned up with the group.

Frame callbacks indicate when drawing is useful; missing callbacks can also mean an obscured surface. They do not identify a precise power state. This follows the [core Wayland frame-callback contract](https://wayland.freedesktop.org/docs/html/apa.html#protocol-spec-wl_surface-request-frame). We deliberately avoid keeping `wlr-output-power-management-v1` objects merely to observe power: the protocol permits exclusive control, and [wlroots rejects a second controller for an output](https://github.com/swaywm/wlroots/blob/master/types/wlr_output_power_management_v1.c#L142), which could interfere with desktop power management.

`node scripts/check-layer-shell.cjs --software --shm --stall --cycle` withholds real compositor frame callbacks, checks that animation and submissions stop, then delivers the callbacks to verify resume, scene transitions and teardown. This does not change monitor power settings. Unit tests cover independent outputs, retained texture releases, duplicate activity events, deferred resize/cycling, and dismissal while stalled. Fullscreen-window fallback relies on Chromium's visibility reporting; explicit power detection and daemon launch suppression while displays are off are not supplied by this change.

## Vendored protocols

The XML copyright/license notices are retained. `wayland-scanner` generates bindings at build time.

- `wlr-layer-shell-unstable-v1.xml`: [swaywm/wlr-protocols](https://github.com/swaywm/wlr-protocols/blob/master/unstable/wlr-layer-shell-unstable-v1.xml), interface version 4; this host binds version 1.
- `linux-dmabuf-unstable-v1.xml`: [wayland-protocols](https://gitlab.freedesktop.org/wayland/wayland-protocols/-/blob/main/unstable/linux-dmabuf/linux-dmabuf-unstable-v1.xml), interface version 5; this host binds version 3.
- `xdg-shell.xml`: [wayland-protocols](https://gitlab.freedesktop.org/wayland/wayland-protocols/-/blob/main/stable/xdg-shell/xdg-shell.xml), generated only to resolve the layer-shell popup type reference; the host does not bind xdg-shell.
