---
title: Troubleshooting
description: Diagnose launch failures, missing idle triggers, double fades, and slow rendering.
---

## `scrnsvr` is not found

Run `command -v scrnsvr`. If it prints nothing, check that `~/.local/bin` (or `$XDG_BIN_HOME`) is on `PATH`. If the AppImage moved or you replaced it with a new release, run its `--install` again. Use the full installed path for an idle service with a different `PATH`. See [installation](../install/).

## The saver does not open

Run `scrnsvr --open` from a terminal inside your Hyprland session and read its error. The saver needs `wlr-layer-shell`, a Wayland output, and EGL/OpenGL ES support from your graphics driver. The error also identifies a missing `XDG_RUNTIME_DIR` if you start it outside the session. See the [system requirements](../install/#requirements).

If the saver opens but Settings fails, start `scrnsvr --settings` from the terminal. Settings also needs a working Vulkan driver.

## It opens manually but not when idle

Check that your [idle service](../idle-setup/) is running and calls the installed `scrnsvr --open`. Look for an old AppImage path, a disabled behavior, or another idle action that locks or powers off the display first. Pause any playing video while testing, since an idle inhibitor can delay the trigger.

## The screen fades twice with Noctalia

Run `scrnsvr --setup-noctalia` to review the idle behavior and Noctalia's pre-action fade. Apply the plan with `scrnsvr --setup-noctalia --apply` to set Noctalia's `idle.pre_action_fade_seconds` to `0`. If the old behavior persists, run `noctalia msg config-reload` or restart Noctalia. The **Fade in and out** setting in scrnsvr controls the remaining transition. [v1.0.0 release notes](https://github.com/rigerc/scrnsvr/releases/tag/v1.0.0#known-limits)

## It opens on the wrong display or closes during a display change

For **Primary**, the saver uses the output at logical position `(0, 0)`, or the first available output if none is at that position. Use **Settings → Monitors → All** to cover every output. If a monitor is connected, disconnected, or changes scale while scrnsvr runs, the saver closes. The next launch detects the new arrangement.

## Animation stutters

Try a lower frame rate in **Settings**. Bypass **Effects** to check whether the stack is the cause. Bloom adds rendering passes and Datamosh / Trails keeps previous frames in GPU memory, so start by reducing the number of those layers. Check stderr for frame statistics with `SCRNSVR_RENDERER_DEBUG=1 scrnsvr --open`.
