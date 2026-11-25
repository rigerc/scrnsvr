---
title: Install scrnsvr
description: Check system requirements, install the Linux AppImage, and try the screensaver.
sidebar:
  order: 1
---

## Requirements

- **Hyprland on Wayland** is the supported desktop. Other compositors that support `wlr-layer-shell`, such as Sway, may work. GNOME and X11 are unsupported.
- **Linux x86-64 and glibc 2.35 or newer** for the AppImage. The screensaver needs OpenGL ES 2.0 over EGL. The settings window also needs Vulkan.
- **Host libraries** include Pango, Cairo, GLib, Fontconfig, FreeType, HarfBuzz, libxkbcommon, libxcb, Wayland, EGL, and Vulkan. Use your distribution's packages if a library is missing.
- **Noctalia 5.x or hypridle** is optional and starts scrnsvr when your session goes idle.

## Install the AppImage

1. Download the AppImage and its matching checksum file from [GitHub Releases](https://github.com/rigerc/scrnsvr/releases/latest). Keep the AppImage somewhere you can leave it, such as `~/Applications`.
2. In that directory, verify the download, mark it executable, and install the command. These filenames are for v1.2.0. For a newer release, substitute its version.

   ```sh
   sha256sum -c SHA256SUMS-1.2.0-native.txt &&
   chmod +x Scrnsvr-1.2.0-x86_64.AppImage &&
   ./Scrnsvr-1.2.0-x86_64.AppImage --install
   ```

   The installer runs after the checksum reports `OK`. It links `scrnsvr` into `~/.local/bin` or `$XDG_BIN_HOME` if set. Keep that directory on `PATH` and leave the AppImage at the location you installed it from.

3. Run `scrnsvr` to open Settings. From a terminal in your Wayland session, run `scrnsvr --open` to try the full-screen saver. Move the pointer or press a key to dismiss it.

Follow [idle setup](../idle-setup/) to launch automatically or [upgrade from 0.x](../upgrade/) to replace an older install.
