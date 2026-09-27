# Authoring shaders

How to add a built-in shader to scrnsvr. For the end-user, no-code path (paste GLSL in Settings) see [Custom and reactive shaders](custom-and-reactive-shaders.md); this document is for contributors adding a shader to the shipped collection.

> **Prototyping a look?** See [Authoring shaders with the shadereye MCP](authoring-shaders-with-shadereye.md) for the fast local iteration loop (Shadertoy-dialect prototype → port → `check-shaders`), and for what shadereye cannot verify.

A shader is a folder containing **two files**:

```
src/renderer/shaders/<id>/
├── manifest.ts    # controls, metadata, defaults
└── shader.glsl    # GLSL ES 1.00 fragment shader
```

The registry is generated, so creating the folder is enough to make the shader appear. Run `npm run build` (or `npm run typecheck`) and `scripts/generate-shader-registry.mjs` rewrites `src/renderer/shaders/generated.ts` with the import, the manifest, and `animationTime: 'integrated'`.

## Hard rules (these are enforced by tests and `check-shaders`)

1. **`<id>` must equal the folder name.** Tests read `src/renderer/shaders/${manifest.id}/shader.glsl`; a mismatch fails `npm test`.
2. **One shader per folder, one exported manifest const.** The generator takes the *first* `export const X =` in `manifest.ts`. Do not export helpers before it.
3. **GLSL ES 1.00 only.** The shader is compiled in **both** a `webgl` (WebGL 1) and a `webgl2` context. No `#version 300 es`, no `in/out`, no `texture()`. Use `gl_FragColor`, `varying`-free fragment-only source, and start with `precision highp float;`.
4. **Every declared uniform must be *used*.** Compilers drop dead uniforms; the harness asserts `gl.getUniformLocation(program, name) !== null` and declares it an error: `unused uniform <name>`. A declaration alone is not enough — reference it in `main()`.
5. **Every control must change the picture.** For each uniform the harness renders its options/endpoints and requires a pixel difference, so default-valued or purely cosmetic controls are rejected.
6. **`speed` can only scale time.** See [Time and speed](#time-and-speed).
7. **Saturation 0 must be exactly grayscale.** Every red/green/blue byte must match.

## The fragment source contract

The runtime draws one fullscreen triangle and binds these uniforms before every draw:

| Uniform | Type | Meaning |
|---|---|---|
| `uTime` | `float` | Animation time in seconds. For built-ins it is the *integrated* phase (`Σ dt · speed`); see below. |
| `uResolution` | `vec2` | Drawing-buffer size in pixels. |
| `uDate` | `vec4` | `(year, month, day, secondsSinceMidnight)` — for clock shaders. |
| `uAudio` | `vec4` | `(low, mid, high, level)` in 0–1. Declare/use it and the app subscribes to audio capture automatically. |

You declare only what you use. There are **no textures, no multipass buffers, no `iChannel`s, and no extra engine uniforms** — everything else comes from your manifest.

```glsl
precision highp float;

uniform float speed;
uniform vec2 uResolution;
uniform float uTime;

void main() {
  // Short-edge normalization: keeps the framing sane in portrait and ultrawide.
  vec2 p = (2.0 * gl_FragCoord.xy - uResolution.xy) / min(uResolution.x, uResolution.y);
  float t = uTime * speed;
  gl_FragColor = vec4(0.5 + 0.5 * sin(p.x * 6.0 + t), 0.5 + 0.5 * cos(p.y * 6.0 + t), 0.5, 1.0);
}
```

## Time and speed

This is the single most common source of failing checks.

- The render harness drives `uTime` directly and expects `speed` to multiply it, so **every** time-dependent term must be written as `uTime * speed` (commonly hoisted into `float t = uTime * speed;`). The zero-speed check renders at `uTime = 0` and `uTime = 100` with `speed = 0` and requires an **identical** frame; any animation term that ignores `speed` breaks it.
- In the real app, `animationTime: 'integrated'` means the runtime already folds speed into `uTime` and forces the `speed` uniform to `1`. So `uTime * speed` behaves as "artistic phase" and editing speed never jumps the composition. Pausing holds the current frame.
- Therefore `speed` must **only** multiply time. If you want a control that scales amplitude, give it its own name — a shader that reads `speed` for anything but time will look different in the app than in the checks.
- Suspension gaps are discarded; do not try to compensate for wall-clock time.

Reactive shaders are the deliberate exception: audio response may continue at `speed = 0`. Use a separate `sensitivity` / `audioShape` control for that and never scale audio by `speed`.

## The manifest

```ts
import { manifest } from '../../../shared/manifest';

export const moireGridManifest = manifest({
  id: 'moire-grid',          // must equal the folder name
  title: 'Moiré Grid',       // shown in Settings
  category: 'Abstract',      // optional, defaults to 'Abstract'
  description: 'Interfering grids drift into slow moiré bands.',
  fragment: 'shader.glsl',   // always 'shader.glsl'
  uniforms: [ /* ... */ ],
});
```

Manifest-level fields:

| Field | Notes |
|---|---|
| `id` | Config key and folder name. |
| `title` | Human name in the gallery. |
| `category` | One of `Abstract, Ambient, Clocks, Custom, Digital, Landscapes, Reactive, Space, Water`. `Custom` is reserved for user shaders. `Reactive` is produced by the `reactiveManifest` helper. |
| `description` | Short sentence. Imported shaders also carry a provenance line. |
| `fragment` | Always `'shader.glsl'`. |
| `schemePalette` | Optional. Name of an option in a `select` uniform named `palette`; applying a color scheme then switches to that option. Used by imports to toggle an `original` → `custom` treatment. |

### Uniform fields

```ts
{
  name: 'scale',                       // must match `uniform float scale;` exactly
  type: 'float',                       // float | int | bool | color | select
  default: 9,
  min: 2, max: 24, step: 0.1,          // required for float/int
  label: 'Grid density',
  description: 'Number of grid lines across the short edge.',
  group: 'Shape',                      // Motion | Shape | Color
  advanced: false,                     // true hides it behind "Advanced"
  unit: '°',                           // optional suffix, e.g. degrees
  colorRole: 'primary',                // color uniforms only
  options: ['original', 'custom'],     // select only
  visibleWhen: { name: 'palette', value: 'custom' }, // conditional visibility
  random: { min: 5, max: 14 },         // conservative randomize window; `false` to lock
}
```

Type → GLSL declaration mapping (asserted by tests):

| `type` | GLSL | Notes |
|---|---|---|
| `float` | `uniform float name;` | |
| `int` | `uniform int name;` | rounded on input |
| `bool` | `uniform bool name;` | |
| `color` | `uniform vec3 name;` | hex `#rrggbb` → 0–1 RGB, no sRGB conversion |
| `select` | `uniform int name;` | value is the index into `options` |

Authoring rules the tests enforce:

- `name` is unique; numbers have finite `min`/`max`, `step > 0`, `default` inside the range and aligned to `step`.
- Every uniform has a non-empty `label` and `description`, and a `group` of `Motion`, `Shape`, or `Color`. The settings UI requires at least three visible groups.
- `visibleWhen.value` must match the parent's type: an option string for `select`, a boolean for `bool`, a number for `float`/`int`. A type mismatch hides the control forever.
- `random.min`/`max` must lie inside `min`/`max`. Omit `random`, or set `random: false` to keep a control fixed while randomizing (backgrounds and audio dials are normally locked).
- Include the three standard controls every shader shares: `speed` (Motion), `brightness` and `saturation` (Color). Imported shaders additionally require `contrast`.
- No control may divide by zero at its endpoints — the harness renders every numeric `min` and `max` at `uTime = 86400`.

### Colors and color schemes

Color schemes and the Noctalia import rewrite color uniforms by role. Set `colorRole` explicitly (`primary`, `secondary`, `tertiary`, `surface`, `onSurface`) and describe the material in `label`/`description`. If omitted, the role is inferred from the name (`color1` → primary, `background` → surface, …), which is only a compatibility fallback.

If a shader has a `palette` select with an `original`/`custom` split, set `schemePalette: 'custom'` so choosing a scheme reveals the scheme colors.

### Audio (Reactive category)

Use the shared helper in `src/renderer/reactive-manifest.ts`; it supplies `speed`, `sensitivity`, `audioLight`, `audioShape`, and the standard color controls with the expected ranges:

```ts
import { reactiveManifest } from '../../reactive-manifest';

export const myReactiveManifest = reactiveManifest(
  'reactive-my-effect',
  'My Effect',
  'One sentence describing the ambient motion.',
  ['#85677f', '#bf9075', '#14121c'],  // color1, color2, background
);
```

Audio checks require a visible-but-restrained response: the pixel delta between silence and loud audio must fall in a narrow band, remain present at `speed: 0`, and vanish at `sensitivity: 0`.

## Visual conventions

- **Aspect**: normalize by `min(uResolution.x, uResolution.y)` so the composition reads in portrait (the harness tests 360×640) and ultrawide (960×270) as well as 16∶9.
- **Finish**: apply `brightness` as intensity (multiplicative or exponential — match the shader's own color path; do not introduce a blanket gamma change), then desaturate, then dither. The standard tail is:

  ```glsl
  col *= brightness;
  col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, saturation);
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  gl_FragColor = vec4(clamp(col + (dither - 0.5) / 255.0, 0.0, 1.0), 1.0);
  ```

  The dither is a single scalar added to all three channels, so grayscale survives; per-channel noise would fail the saturation check. Keep it *static* (based on `gl_FragCoord`, not `uTime`) so paused frames stay identical.
- **Clamp before output.** Values above 1 or NaN trip the `GL error` / bounds checks.
- **Cheap loops.** WebGL 1 forbids non-constant loop bounds and dynamic array indexing; unroll or use analytic functions. Keep 1080p cost reasonable — `check-shaders` reports readback timing per shader.
- **No textures or passes.** Effects must be procedural and single-pass. If you need state, encode it analytically.

## Worked example

`src/renderer/shaders/moire-grid/manifest.ts`:

```ts
import { manifest } from '../../../shared/manifest';

export const moireGridManifest = manifest({
  id: 'moire-grid',
  title: 'Moiré Grid',
  category: 'Abstract',
  description: 'Interfering grids drift into slow moiré bands.',
  fragment: 'shader.glsl',
  uniforms: [
    { name: 'speed', type: 'float', default: 0.5, min: 0, max: 2, step: 0.01,
      label: 'Speed', description: 'Overall animation speed; zero freezes all movement.',
      group: 'Motion', random: { min: 0.1, max: 0.8 } },
    { name: 'scale', type: 'float', default: 9, min: 2, max: 24, step: 0.1,
      label: 'Grid density', description: 'Number of grid lines across the short edge.',
      group: 'Shape', random: { min: 5, max: 14 } },
    { name: 'drift', type: 'float', default: 0.35, min: 0, max: 1.5, step: 0.01,
      label: 'Drift', description: 'How far the grid wanders over time.',
      group: 'Motion', random: { min: 0.15, max: 0.6 } },
    { name: 'brightness', type: 'float', default: 1, min: 0.2, max: 2, step: 0.01,
      label: 'Brightness', description: 'Overall light intensity.',
      group: 'Color', random: { min: 0.7, max: 1.2 } },
    { name: 'saturation', type: 'float', default: 1, min: 0, max: 2, step: 0.01,
      label: 'Saturation', description: 'Color intensity; zero is grayscale.',
      group: 'Color', advanced: true, random: { min: 0.6, max: 1.3 } },
    { name: 'color', type: 'color', default: '#ff7ac6',
      label: 'Line color', description: 'Color of the brighter grid bands.',
      group: 'Color', colorRole: 'primary' },
    { name: 'background', type: 'color', default: '#0b0f1a',
      label: 'Background', description: 'Color behind the grid.',
      group: 'Color', random: false },
  ],
});
```

`src/renderer/shaders/moire-grid/shader.glsl`:

```glsl
precision highp float;

uniform float speed;
uniform float scale;
uniform float drift;
uniform float brightness;
uniform float saturation;
uniform vec3 color;
uniform vec3 background;
uniform vec2 uResolution;
uniform float uTime;

void main() {
  vec2 p = (2.0 * gl_FragCoord.xy - uResolution.xy) / min(uResolution.x, uResolution.y);
  float t = uTime * speed;                       // speed only ever scales time
  p += drift * vec2(sin(t * 0.21), cos(t * 0.17)); // bounded wander at all endpoints
  float pattern = sin(p.x * scale) * sin(p.y * scale);
  pattern = 0.5 + 0.5 * sin(pattern * 6.28318 + t * 0.6);
  vec3 col = mix(background, color, pattern);
  col *= brightness;
  col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, saturation);
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  gl_FragColor = vec4(clamp(col + (dither - 0.5) / 255.0, 0.0, 1.0), 1.0);
}
```

## Register the shader in the test suite

The registry is automatic, but the parameter-contract test uses an explicit list. Add the manifest to `tests/shader-manifests.test.ts` (import + entry in the `manifests` array) so `npm test` covers defaults, ranges, randomization, and the `uniform … name;` declarations.

Optionally add the id to `featuredIds` in `src/settings/index.ts` to pin it to the Featured row, and add a row to the table in [docs/shader-parameters.md](shader-parameters.md) describing its controls. Imported shaders additionally require entries in `THIRD_PARTY_SHADERS.md` and generation through `scripts/import-upstream-shaders.mjs` — do not hand-edit those.

## Checklist

```sh
npm run typecheck        # regenerates the registry, then typechecks
npm test                 # manifest contracts, runtime, uniforms
npm run check-shaders    # real Chromium/WebGL: WebGL1 + WebGL2, all rules above
```

Then eyeball it:

```sh
npm start -- --preview --shader moire-grid
```

Before opening a PR, confirm:

- [ ] Folder name, `manifest.id`, and test entry agree.
- [ ] `shader.glsl` is GLSL ES 1.00, starts with `precision highp float;`, writes `gl_FragColor`.
- [ ] Every declared uniform is referenced in `main()` and visibly changes output.
- [ ] All animation flows through `uTime * speed`; `speed: 0` freezes exactly.
- [ ] `saturation: 0` is exactly grayscale; output is clamped; dither is static.
- [ ] Numeric `min`/`max` endpoints render without GL errors at `uTime = 86400`.
- [ ] `speed`, `brightness`, `saturation` present with correct groups; every uniform labeled, described, and grouped.
- [ ] `visibleWhen` values match the parent control's type.
- [ ] Colors carry `colorRole` and lock `random: false` where the background should stay fixed.
