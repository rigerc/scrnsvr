# scrnsvr

A shader-based idle screensaver for Linux desktops. Electron + WebGL (OGL) renderers launch fullscreen after a configurable idle timeout, with a settings UI, clock overlay, and systemd user service.

## Features

- 7 GLSL shaders: `aurora-veil`, `flow-field`, `gradient-blobs`, `gradient-drift`, `interference`, `mesh-gradient`, `plasma`
- Per-shader uniforms (speed, palette, colors, etc.) with per-shader saved values and presets
- Clock overlay: 12h/24h, seconds/date toggles, 9 positions, font/weight/size/color/opacity/margin/shadow
- Noctalia colors import: maps `mPrimary/mSecondary/mTertiary/mSurface/mOnSurface` onto shader color uniforms
- Idle daemon: polls `powerMonitor.getSystemIdleTime()` with a `logind` (`busctl`) fallback; suppresses relaunch for one poll after resume
- Primary / all-monitors rendering, kiosk mode, configurable FPS (1–240)
- Settings window (`--settings`), preview mode (`--preview --shader <id>`), headless thumbnail capture (`--thumbnail`)
- Config at `~/.config/scrnsvr/config.json` (or `$XDG_CONFIG_HOME/scrnsvr/config.json`), Zod-validated with atomic writes
- Linux packaging: AppImage + deb via electron-builder, ships a systemd user unit (`scrnsvr.service`)

## Requirements

- Linux with Node 24 + npm
- Electron 44 (devDependency, allowed via `allowScripts`)
- `busctl` only if you rely on the logind idle fallback (Wayland without Electron idle data)

## Quick start

```sh
npm install
npm run build

# Preview a shader in a window
npm start -- --preview --shader gradient-blobs

# Open settings
npm run settings

# Run the idle daemon in the foreground
npm run daemon

# Typecheck / tests
npm run typecheck
npm test
```

CLI flags (`src/main/cli.ts`): `--settings|-s`, `--daemon`, `--preview`, `--shader <id>`, `--thumbnail`, `--output <dir>`, `--frames <n>`.

## Config

Resolved by `configPath()` in `src/shared/config.ts`:

- active shader, global FPS / idle threshold / monitor scope, clock block, `shaders` values, `presets`
- legacy top-level `fps`/`monitor` keys are migrated into `global` on load

Example (`~/.config/scrnsvr/config.json`):

```json
{
  "shader": "gradient-blobs",
  "global": { "idleThresholdSeconds": 300, "fps": 60, "monitors": "primary" },
  "kiosk": true,
  "clock": { "enabled": true, "position": "center", "format": "24h", "showSeconds": false, "showDate": true },
  "shaders": { "plasma": { "speed": 0.65 } },
  "presets": {}
}
```

## Packaging

```sh
npm run dist
```

Outputs to `release/` (AppImage, deb). The deb `afterInstall` hook installs the user unit to `/usr/lib/systemd/user/scrnsvr.service`; enable with:

```sh
systemctl --user daemon-reload
systemctl --user enable --now scrnsvr.service
```

## Project layout

- `src/main/` — Electron entry, CLI, idle daemon, Noctalia loader, IPC (`config:get/set`, `colors:import-noctalia`)
- `src/renderer/` — OGL runtime (`core/runtime.ts`), clock overlay (`core/clock.ts`), shader set (`shaders/*/manifest.ts` + `shader.glsl`)
- `src/settings/` — settings window UI + clock controls
- `src/shared/` — Zod config, clock/Noctalia helpers, IPC keys, shader manifest schema
- `scripts/build.mjs` — esbuild bundles for main/preload/renderer/settings + static copies
- `scripts/generate-shader-registry.mjs` — generates `src/renderer/shaders/generated.ts`
- `tests/` — vitest suites for CLI, config, daemon, Noctalia, uniforms (14 tests)
- `packaging/` — systemd unit + deb post-install script
