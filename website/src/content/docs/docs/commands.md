---
title: Command-line reference
description: Open, dismiss, preview, install, and configure scrnsvr from a terminal.
sidebar:
  order: 5
---

| Command | Behavior |
| --- | --- |
| `scrnsvr` or `scrnsvr --settings` | Open Settings. |
| `scrnsvr --open [--shader <id>]` | Start the full-screen saver. `--shader` picks the starting visual. |
| `scrnsvr --dismiss` | Fade out the running saver. Exits successfully if no saver is running. |
| `scrnsvr --preview [--shader <id>]` | Open a resizable 960×540 preview window with shuffle disabled. |
| `scrnsvr --thumbnail [--output <dir>] [--frames <n>]` | Render 640×360 PNGs for the built-in shaders. Defaults to `assets/thumbnails` and 3 frames per shader. |
| `scrnsvr --install [--force]` | Link the AppImage or binary into `~/.local/bin` or `$XDG_BIN_HOME`. Use `--force` only to replace an unrelated file or link intentionally. |
| `scrnsvr --setup-noctalia [--apply] [--timeout <seconds>]` | Review Noctalia idle setup or apply it with `--apply`. |
| `scrnsvr --help` | Print command help. |

The brackets mark optional flags. For example, try the built-in Flow Field shader in a window:

```sh
scrnsvr --preview --shader flow-field
```

While one full-screen saver runs, another `--open` exits successfully without opening a second. A key press, click, scroll, touch, or pointer movement beyond 12 logical pixels dismisses the saver across all outputs.

For per-second renderer statistics, run `SCRNSVR_RENDERER_DEBUG=1 scrnsvr --open` and check stderr.
