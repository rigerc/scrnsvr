---
title: TOML configuration
description: Look up configuration paths, TOML keys, defaults, and valid values.
sidebar:
  order: 6
---

Settings saves to `$XDG_CONFIG_HOME/scrnsvr/config.toml`, usually `~/.config/scrnsvr/config.toml`. Close the settings window before editing the file by hand so autosave cannot overwrite your changes. Use snake_case for the config keys and the exact manifest names for individual shader and effect controls.

The loader warns about invalid values and keeps valid settings from the same file. If TOML parsing fails, scrnsvr reports the error, uses defaults and leaves the file on disk for repair.

| Other files | Location |
| --- | --- |
| Favorites and interface state | `$XDG_STATE_HOME/scrnsvr/ui.toml` (usually `~/.local/state/scrnsvr/ui.toml`) |
| Cached thumbnails | `$XDG_CACHE_HOME/scrnsvr/thumbnails/` (usually `~/.cache/scrnsvr/thumbnails/`) |

## Example

This uses Flow Field with a smaller clock, the Nord palette, and a VHS layer. Shuffle picks from the current Flow Field settings and a saved look, then changes every ten minutes.

```toml
shader = "flow-field"

[global]
fps = 60
fade_seconds = 1.0
monitors = "primary"

[clock]
position = "bottom-right"
size = 8.0
show_date = false

[colors]
scheme = "nord"

[shaders.flow-field]
speed = 0.65

[presets.flow-field."Midnight drift"]
speed = 0.30

[rotation]
enabled = true
interval_minutes = 10.0

[[rotation.entries]]
shader = "flow-field"

[[rotation.entries]]
shader = "flow-field"
preset = "Midnight drift"

[[effects.layers]]
id = "tape-1"
effect_id = "vhs-distortion"
values = { intensity = 0.25 }
```

## Visuals and display

| Key | Default | Values |
| --- | --- | --- |
| `shader` | `"flow-field"` | A built-in or custom shader ID |
| `global.fps` | `60` | `1`–`240` frames per second |
| `global.fade_seconds` | `1.0` | `0.0`–`5.0` seconds. Zero makes the transition immediate. |
| `global.monitors` | `"primary"` | `"primary"` or `"all"` |
| `global.idle_threshold_seconds` | `300.0` | Legacy field accepted for compatibility. Set the activation timeout in your [idle service](../idle-setup/). |
| `colors.scheme` | `"none"` | A scheme ID or `"none"` for built-in colors |
| `colors.overrides` | Empty table | Map a shader ID to a scheme ID or `"none"`. Omit the shader key to inherit the global scheme. |
| `shaders.<id>` | Empty table | Control values for a shader |
| `presets.<id>.<name>` | Empty table | Saved look for a shader. Quote names that contain spaces. |

Find IDs and control names in the built-in [shader manifests](https://github.com/rigerc/scrnsvr/tree/main/data/shaders), [effect manifests](https://github.com/rigerc/scrnsvr/tree/main/data/effects), and [palette list](https://github.com/rigerc/scrnsvr/blob/main/data/palettes.json).

## Clock

These keys go under `[clock]`. Size and margin are percentages of the screen's shorter side.

| Key | Default | Values |
| --- | --- | --- |
| `enabled` | `true` | Show or hide the overlay |
| `position` | `"center"` | `"top-left"`, `"top-center"`, `"top-right"`, `"center-left"`, `"center"`, `"center-right"`, `"bottom-left"`, `"bottom-center"`, `"bottom-right"` |
| `font` | `"system"` | `"system"`, `"serif"`, `"monospace"`, `"rounded"`, or `"custom"` |
| `custom_font` | `""` | An installed font family when `font = "custom"` |
| `size` | `12.0` | `2.0`–`30.0` percent |
| `weight` | `300` | `100`–`900` |
| `color` | `"#ffffff"` | A quoted `#RRGGBB` color |
| `opacity` | `0.95` | `0.1`–`1.0` |
| `margin` | `5.0` | `0.0`–`20.0` percent |
| `format` | `"24h"` | `"24h"` or `"12h"` |
| `show_seconds` | `false` | Include seconds in the standard time format |
| `show_date` | `true` | Show the date on its own line |
| `shadow` | `true` | Draw a shadow behind the clock |
| `pattern` | Unset | A strftime time format, such as `"%H:%M:%S"`. Overrides `format` and `show_seconds`. |

## Shuffle, effects, and custom shaders

- `[rotation]` defaults to `enabled = false` and an empty list. Add `[[rotation.entries]]` tables with `shader` and an optional `preset` name. With shuffle enabled, `interval_minutes = 0.0` picks once per launch. A positive interval up to `180.0` also changes the visual while the saver runs.
- `[effects]` defaults to `enabled = true` with an empty stack. Add up to eight `[[effects.layers]]` tables. Each takes an `effect_id`, a unique instance `id`, `enabled` (defaults to `true`), and a `values` table for control overrides. The app generates an instance ID if you omit `id`.
- Add `[[custom_shaders]]` entries with `id`, `title`, and GLSL `source`. Each ID starts with `custom-` followed by 1–80 lowercase ASCII letters, digits, or hyphens. The [shader editor](../custom-shaders/) handles IDs, validation, and saving for you.
