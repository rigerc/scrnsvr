# ADR-001: Native Wayland presentation for the screensaver

Status: Accepted. Date: 2026-11-01.

## Context

Electron's fullscreen windows leave placement and stacking to the compositor. A screensaver on layer-shell compositors needs explicit output selection, coverage above fullscreen applications and panels, and keyboard/pointer dismissal. Existing shaders, settings, audio IPC, clock, rotation and fades should continue to run in Electron.

## Decision

Use a small Node-API host in `native/layer-shell.cc` to create independent `wlr-layer-shell` surfaces. Electron renders offscreen. One surface per selected output uses the overlay layer, all four anchors, exclusive zone `-1`, and exclusive keyboard interactivity. The compositor supplies logical dimensions; integer output scale determines buffer pixel dimensions. Fractional-scale outputs use the compositor's integer buffer scale, which can oversample. Output topology or scale changes close the entire group so the next launch rediscovers outputs.

The host integrates its connection with Electron's libuv loop. Discovery has a bounded timeout. Wayland listeners defer JavaScript notifications through a Node-API thread-safe function so cleanup cannot reenter Wayland dispatch. Protocol disconnects and renderer crashes tear down the group.

Prefer Electron's single-plane RGBA/BGRA DMA-BUF textures when the compositor advertises the exact format/modifier. Use asynchronous buffer creation so an unsupported import can fail without terminating the connection. Keep each Electron texture leased until `wl_buffer.release`. Limit each renderer to two outstanding frames. If GPU export fails at startup, recreate the offscreen renderers with Electron's bitmap producer; if an individual import fails, use paced readback. Bitmap frames are copied into bounded, compositor-owned SHM buffers and released on the same protocol event.

Native input sends a dismissal notification to every renderer through the preload bridge. Existing fades run before the first renderer closes the group. A six-second deadline removes the surfaces if renderers stop responding. Pointer movement uses a 12-logical-pixel threshold and the pointer is hidden over the surfaces.

`--backend auto` attempts this on Linux with `WAYLAND_DISPLAY`; startup failure falls back to the existing fullscreen windows. `layer-shell` requires native presentation and reports startup failure. `fullscreen` bypasses native presentation. Settings, previews and thumbnail capture keep their existing paths. Native compilation is optional during ordinary builds; `build:layer-shell` requires it. Packaged `.node` files are unpacked from ASAR. The module uses Electron's Node-API and libuv exports and the system Wayland client library.

## Alternatives

- Use `@covas-labs/electron-overlay`: its experimental layer-shell implementation owns an independent surface and supports DMA-BUF, but documents no keyboard focus and an empty input region. A screensaver requires native input, so using it unchanged would leave dismissal unsupported. [Package documentation](https://github.com/COVAS-Labs/electron-overlay/blob/main/packages/electron-overlay/README.md#experimental-layer-shell-surface).
- Replace the renderer with GTK/WebKit or native GL: this would require broader renderer integration and diverge from the existing WebGL runtime.
- Reassign Electron's surface role: the layer-shell protocol rejects surfaces already assigned another role, so the host must own its surfaces. [Protocol](https://github.com/swaywm/wlr-protocols/blob/master/unstable/wlr-layer-shell-unstable-v1.xml).

## Verification and limits

Unit tests cover selection, modifier precision, texture leases, bounded submissions, startup cleanup, input shutdown, hotplug, and GPU import fallback. `scripts/check-layer-shell.cjs` exercises the real compositor and production renderer/preload, checks shader pixels, continuous presentation, frame release, and teardown. `--shm` forces bitmap frames; `--input` also checks pointer dismissal through Hyprland 0.55+ and restores the cursor. These checks briefly cover the primary display.

On the development NVIDIA/Hyprland system, shared-texture export fails and automatic retry with bitmap frames works. DMA-BUF presentation remains driver dependent; it needs hardware verification on a driver that exports compatible textures. Bitmap frames preserve GPU shader rendering but incur CPU readback and copy costs. Actual mixed-scale and multi-monitor hardware still need verification beyond the lifecycle unit tests.

Layer-shell supplies desktop overlay behavior, not session locking or authentication. Idle detection is unchanged.

## Vendored protocols

The XML copyright/license notices are retained. `wayland-scanner` generates bindings at build time.

- `wlr-layer-shell-unstable-v1.xml`: [swaywm/wlr-protocols](https://github.com/swaywm/wlr-protocols/blob/master/unstable/wlr-layer-shell-unstable-v1.xml), interface version 4; this host binds version 1.
- `linux-dmabuf-unstable-v1.xml`: [wayland-protocols](https://gitlab.freedesktop.org/wayland/wayland-protocols/-/blob/main/unstable/linux-dmabuf/linux-dmabuf-unstable-v1.xml), interface version 5; this host binds version 3.
- `xdg-shell.xml`: [wayland-protocols](https://gitlab.freedesktop.org/wayland/wayland-protocols/-/blob/main/stable/xdg-shell/xdg-shell.xml), generated only to resolve the layer-shell popup type reference; the host does not bind xdg-shell.
