---
title: "Add 30 well-known palettes as pickable color schemes"
status: draft
created: "2026-09-26T17:21:15.208Z"
updated: "2026-09-26T17:21:24.080Z"
type: feature
---

# Add 30 well-known palettes as pickable color schemes

## Goal

Let users pick from 30 well-known palettes extracted from `reference/` and apply them to
every color-aware shader. A **global** scheme applies everywhere by default; each shader can
**override** with a different scheme or opt out to its built-in colors.

`reference/` holds 1247 terminal color-scheme YAMLs (Ghostty/iTerm2 format:
`color_01..color_16`, `background`, `foreground`, `cursor`, `variant`). Today palettes are
per-shader hardcoded GLSL branches (only `plasma` and `flow-field` expose a `palette`
select), and one existing path already maps a 5-role palette onto arbitrary shaders:
`src/shared/noctalia.ts` → `noctaliaShaderValues`. This plan reuses that role-mapping idea.

## Confirmed decisions

| Decision | Choice |
|---|---|
| Exposure | Global scheme **+** per-shader override |
| Palette source | Generated at build time from curated `reference/*.yml` |
| Mapping | ANSI role mapping (reuse the noctalia role model) |
| Batch contents | Core classics + Ayu/Rosé Pine/Kanagawa + GitHub/Material/Everforest/Iceberg (no Catppuccin this batch) |

## The 30 palettes

All rows verified present and complete (16 ANSI + background + foreground) in `reference/`.

| # | id | Display name | `reference/` file | Variant |
|---|---|---|---|---|
| 1 | `dracula` | Dracula | `Dracula.yml` | dark |
| 2 | `nord` | Nord | `Nord.yml` | dark |
| 3 | `gruvbox-dark` | Gruvbox Dark | `Gruvbox Dark.yml` | dark |
| 4 | `gruvbox-light` | Gruvbox Light | `Gruvbox Light.yml` | light |
| 5 | `solarized-dark` | Solarized Dark | `Solarized Dark.yml` | dark |
| 6 | `solarized-light` | Solarized Light | `Solarized Light.yml` | light |
| 7 | `monokai` | Monokai | `Monokai.yml` | dark |
| 8 | `one-dark` | One Dark | `One Dark.yml` | dark |
| 9 | `tokyo-night` | Tokyo Night | `Tokyo Night Dark.yml` | dark |
| 10 | `tokyo-night-storm` | Tokyo Night Storm | `TokyoNight Storm.yml` | dark |
| 11 | `night-owl` | Night Owl | `Night Owl.yml` | dark |
| 12 | `palenight` | Palenight | `Palenight.yml` | dark |
| 13 | `zenburn` | Zenburn | `Zenburn.yml` | dark |
| 14 | `ayu-dark` | Ayu Dark | `Ayu Dark.yml` | dark |
| 15 | `ayu-mirage` | Ayu Mirage | `Ayu Mirage.yml` | dark |
| 16 | `ayu-light` | Ayu Light | `Ayu Light.yml` | light |
| 17 | `rose-pine` | Rosé Pine | `Rose Pine.yml` | dark |
| 18 | `rose-pine-moon` | Rosé Pine Moon | `Rose Pine Moon.yml` | dark |
| 19 | `rose-pine-dawn` | Rosé Pine Dawn | `Rose Pine Dawn.yml` | light |
| 20 | `kanagawa-wave` | Kanagawa Wave | `Kanagawa Wave.yml` | dark |
| 21 | `kanagawa-dragon` | Kanagawa Dragon | `Kanagawa Dragon.yml` | dark |
| 22 | `kanagawa-lotus` | Kanagawa Lotus | `Kanagawa Lotus.yml` | light |
| 23 | `github-dark` | GitHub Dark | `GitHub Dark.yml` | dark |
| 24 | `github-light` | GitHub Light | `Github Light.yml` (lowercase `h`) | light |
| 25 | `material-dark` | Material | `Material Dark.yml` | dark |
| 26 | `material-palenight` | Material Palenight | `Material Palenight.yml` | dark |
| 27 | `everforest-dark` | Everforest Dark | `Everforest Dark.yml` | dark |
| 28 | `everforest-light` | Everforest Light | `Everforest Light.yml` | light |
| 29 | `iceberg-dark` | Iceberg Dark | `Iceberg Dark.yml` | dark |
| 30 | `iceberg-light` | Iceberg Light | `Iceberg Light.yml` | light |

## Data flow

```
reference/*.yml
   │  scripts/generate-palettes.mjs   (build-time, curated list)
   ▼
src/shared/palettes.generated.ts      (checked-in data, 30 palettes)
   │
src/shared/palettes.ts                (roles, resolver, override semantics)
   │
config.colors { scheme, overrides }   (src/shared/config.ts)
   │  effectiveShaderValues(shader, stored, colors)
   ▼
mount sites: renderer/index.ts, settings preview, gallery thumbnails, shader controls
```

## Colour model

**Roles (5)** — same names noctalia already targets: `surface`, `onSurface`, `primary`,
`secondary`, `tertiary`. Derived from each palette by fixed ANSI indices (ANSI is 0-based:
ANSI 0 = `color_01`):

| Role | Source |
|---|---|
| `surface` | palette `background` |
| `onSurface` | palette `foreground` |
| `primary` | ANSI 4 — blue slot, `color_05` (usually the theme signature colour) |
| `secondary` | ANSI 5 — magenta slot, `color_06` |
| `tertiary` | ANSI 6 — cyan slot, `color_07` |

Each curated entry may carry an optional `roles` override in the curated list for
flagship-fidelity fixes (e.g. force a warmer primary), applied during generation.

**Uniform mapping** (generalised from `noctaliaShaderValues`):
- `background`, `backgroundTop`, `shadow` → `surface`
- `highlight`, `color4` → `onSurface`
- `color`, `color1`, `midtone` → `primary`
- `color2` → `secondary`
- `color3` → `tertiary`
- Remaining `color` uniforms cycle through `[primary, secondary, tertiary]` in manifest order.
- Dependent selects: `flow-field` → `palette = 'aurora'`; `plasma` → `palette = 'custom'`.

**Resolution:** `effective = { ...shaderSchemeValues(shader, colors), ...stored }`.
Only colour uniforms and the dependent `palette` select are produced by the scheme; **stored
user overrides always win**. Stored keys exist only when the user (or noctalia import, or
randomize) set them — Reset deletes them.

**Scheme selection resets stale colours:** picking a scheme clears the affected shaders'
colour-uniform keys and dependent `palette` key, so the chosen scheme is immediately visible
over previously randomized/imported colours. Motion/shape keys and saved presets are untouched.

**Randomize with an active scheme:** `randomizeUniforms` protects colour uniforms (and the
dependent `palette` select) while a scheme is active, so shuffling does not destroy the theme.
Brightness/saturation and all motion/shape controls still randomize.

## Phases

### Phase 1 — Palette generation pipeline
1. Add `scripts/palettes.config.mjs`: ordered array of `{ id, file, name, roles? }` for the 30 rows above.
2. Add `scripts/generate-palettes.mjs`:
   - Parse each YAML with a small fixed-schema reader (lines of `key: 'value' # comment`; strip quotes + trailing comments).
   - Validate: `color_01..color_16`, `background`, `foreground`, `variant` present; every colour matches `#rgb`/`#rrggbb`; expand 3-digit hex to 6-digit lowercase.
   - Fail the build with the offending file name on any mismatch.
   - Emit `src/shared/palettes.generated.ts` exporting a typed, ordered `palettes` array (`id`, `name`, `variant`, `background`, `foreground`, `cursor`, `ansi: [16]`). Deterministic output, header comment "Do not edit by hand".
3. Wire the script into `scripts/build.mjs` (alongside `generate-shader-registry.mjs`) and into the `typecheck` npm script so generated data always exists.
4. Commit the generated file (required by `vitest`, and lets builds run without `reference/`).

**Verification:** run `node scripts/generate-palettes.mjs` twice → second run is a no-op diff;
`npx tsc -p tsconfig.json --noEmit`; confirm 30 entries and no `reference/` path strings in the emitted data.

### Phase 2 — Shared palette logic
1. Add `src/shared/palettes.ts`:
   - `paletteById`, `paletteRoles(palette)`, `SCHEME_NONE = 'none'`.
   - `schemeForShader(shaderId, colors)`: `overrides[id]` if set and not `''`, else `colors.scheme`; `''`/`none` → no scheme.
   - `shaderSchemeValues(shader, colors)`: partial uniform values (colours + dependent select) for the effective scheme, or `{}`.
   - `effectiveShaderValues(shader, stored, colors)`: spread merge, stored wins.
   - `clearShaderColorOverrides(shader, stored)`: delete colour-uniform keys + dependent `palette` key.
2. Refactor `src/shared/noctalia.ts` to build `ColorRoles` and reuse one shared `applyColorRoles(shader, roles)` helper (keep `parseNoctaliaPalette` behaviour and hex normalisation unchanged). Noctalia import keeps writing into `config.shaders[id]` (explicit overrides) and is unaffected by schemes.
3. Add `tests/palettes.test.ts`: 30 unique ids, valid 6-hex colours, required ids present, role derivation, scheme precedence, per-shader override, `none`, and clearing only colour keys.

**Verification:** `npx vitest run tests/palettes.test.ts tests/noctalia.test.ts`.

### Phase 3 — Config schema
1. In `src/shared/config.ts` add:
   ```ts
   const ColorSchemeSchema = z.object({
     scheme: z.string().default('none'),
     overrides: z.record(z.string(), z.string()).default({}),
   }).default({});
   ```
   and `colors: ColorSchemeSchema` on `ConfigObjectSchema` (preserved by the existing preprocess/transform). Unknown scheme ids are tolerated and degrade to `none` at resolve time (forward/backward compatible with older builds).
2. Extend `tests/config.test.ts`: defaults (`scheme: 'none'`, empty overrides), round-trip of a scheme + per-shader override, legacy config without `colors` still parses.

**Verification:** `npx vitest run tests/config.test.ts`.

### Phase 4 — Settings UI
1. **Global picker** in the Global settings section (`src/settings/index.ts` `bindGlobals` + markup): `<select data-global="scheme">` with a "Built-in colors" (`none`) option and Dark/Light `optgroup`s from `palettes`. `bindGlobals` currently coerces non-`monitors` values with `Number(...)`, so special-case string values (`scheme`).
2. **Per-shader override** in the existing `.color-import` section: `<select data-shader-scheme>` with `Use global scheme` (`''`), `Built-in colors` (`none`), and the 30 schemes. Show it only for shaders that expose `color` uniforms (mirror the `updateColorImport` disable logic); keep the noctalia button and status text.
3. On change (global or override): update `config.colors`, set/delete the override, and for the affected shader(s) call `clearShaderColorOverrides`; then `renderControls()`, `refreshPreview()`, refresh gallery thumbnail values, `queueSave()`.
4. Populate each scheme option with a small colour swatch preview if cheap (swatch mark is optional; list-only is acceptable).

**Verification:** `npm run settings`; select each of the 30 in turn; confirm preview + color controls update; confirm an override on one shader does not change others; confirm "Built-in colors" restores defaults after a scheme.

### Phase 5 — Wire mount sites and live refresh
1. `src/renderer/index.ts` `valuesFor`: return `effectiveShaderValues(shader, resolved, config.colors)` for both initial mount and rotation `onCycle` (config is re-read on cycle, so global scheme changes need a reopen/cycle — document this).
2. `src/settings/index.ts` `refreshPreview` and the gallery `thumbnailStates` `values`: use `effectiveShaderValues`. Keep the captured object reference and mutate it in place (`Object.assign`) on scheme change so live thumbnails update without a full remount.
3. `src/settings/shader-controls.ts`: accept an optional effective-values resolver so controls **display** scheme colours while writes still land in the stored override object; `reset` deletes the stored key and re-syncs to the scheme value. Default resolver preserves current behaviour for callers that pass no scheme.
4. `randomizeUniforms` (`src/renderer/core/uniforms.ts`): accept a set of protected uniform names (or an `activeScheme` flag) and skip colour uniforms + dependent `palette` select while a scheme is active. Update `SettingsPanel.randomize()` to pass it.

**Verification:** thumbnails and preview update on scheme change; per-control Reset falls back to the scheme colour; Randomize keeps the scheme but still shuffles motion/shape; `npm test`.

### Phase 6 — Docs and final verification
1. Update `README.md` (line ~75): add the scheme picker, override behaviour, 30-palette list summary.
2. Update `docs/shader-parameters.md`: new "Color schemes" paragraph — global vs override, ANSI role mapping, scheme-select resets colour overrides, Randomize protection, and that the 31 shaders without `color` uniforms keep built-in palettes.
3. Attribution note (README/docs): palettes derived from `reference/` (iTerm2-Color-Schemes format) — confirm/append the upstream licence note.
4. Full check: `npm run typecheck && npm test && npm run check-shaders` (check-shaders needs Electron + a display/Xvfb; it exercises extremes and grayscale, which covers light schemes).

## Verification summary

| Check | Command |
|---|---|
| Types + generation | `npm run typecheck` |
| Unit tests | `npm test` |
| Shader visual/parameter checks | `npm run check-shaders` |
| Manual | `npm run settings`: 30 options grouped Dark/Light; global applies to all color shaders; per-shader override wins; Built-in restores defaults; Randomize preserves scheme; thumbnails live-update |

## Risks and mitigations

- **YAML parser fragility** → fixed-schema reader with strict validation; any malformed file fails the build naming the file. All 30 were pre-verified complete.
- **`reference/` is currently untracked** and not shipped with the app → the generated module is committed, so builds/tests never read `reference/` at runtime. Decide separately whether `reference/` is committed or kept as a dev-only source.
- **Role mapping is a heuristic** → fixed ANSI indices plus optional per-palette `roles` overrides in the curated list.
- **Light schemes wash out bright/bloom shaders** → brightness/saturation remain user controls; documented; Randomize still respects scheme colours.
- **Stored overrides hide a new scheme** → selecting a scheme clears the affected shaders' colour keys; per-control Reset clears a single override.
- **Global change while the screensaver runs** → renderer reads config at open and on each rotation cycle; document that a running instance picks up a new global scheme on reopen/cycle.

## Out of scope

- Catppuccin and other families (deferred to a later batch; the pipeline makes adding rows trivial).
- Arbitrary user-imported scheme files or an in-app scheme editor.
- Colour schemes for the 31 shaders that expose no `color` uniforms (they keep built-in palettes).
- Redesigning the noctalia import flow (only refactored to share the role helper).