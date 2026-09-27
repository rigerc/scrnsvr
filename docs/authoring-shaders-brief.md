# scrnsvr — shader author brief

You are writing **one new built-in shader** for scrnsvr (Electron + OGL/WebGL idle screensaver). You have no repo access; this is the complete contract. Bracketed **[!]** items are enforced by the project's automated checks.

**Deliver two files:**

```
src/renderer/shaders/<id>/manifest.ts   # metadata + controls
src/renderer/shaders/<id>/shader.glsl   # GLSL ES 1.00 fragment shader
```

`<id>` is kebab-case and **must equal the folder name** **[!]**. Registration is automatic (a build script scans the folders). You are adding an original shader — do not touch the imported/provenance pipeline.

## Platform **[!]**

- Raw **WebGL 1 *and* 2**, fragment shader only. Same source compiles in both contexts.
- **GLSL ES 1.00**: `precision highp float;` first, write `gl_FragColor`, read `gl_FragCoord`. No `#version 300 es`, no `in`/`out`, no `texture()`.
- **No textures, samplers, multipass buffers, or `iChannel`s** — procedural, single-pass only.
- WebGL 1 forbids non-constant loop bounds and dynamic array indexing. Keep 1080p cost modest.

## Engine uniforms

| Uniform | Type | Meaning |
|---|---|---|
| `uTime` | `float` | Integrated animation phase in seconds (§ Time). |
| `uResolution` | `vec2` | Drawing-buffer size in pixels. |
| `uDate` | `vec4` | `(year, month, day, secsSinceMidnight)` — clock faces only. |
| `uAudio` | `vec4` | `(low, mid, high, level)` 0–1; referencing it enables audio capture. |

## Time **[!]**

Hoist `float t = uTime * speed;` and route **every** time-dependent term through it.

- The suite renders `uTime = 0` and `100` at `speed = 0` and requires a **byte-identical** frame. Anything that animates without `speed` fails.
- In the app the runtime already folds speed into `uTime` and passes `speed = 1`, so `speed` **must only ever multiply time** — give amplitude/size controls their own names.
- Reactive/audio response is the one exception: it may persist at `speed = 0`, driven by a separate `sensitivity` dial, never multiplied by `speed`.

## Manifest

`manifest.ts` exports exactly **one** const, as the **first** `export const` **[!]**:

```ts
import { manifest } from '../../../shared/manifest';

export const myShaderManifest = manifest({
  id: 'my-shader',              // == folder name
  title: 'My Shader',
  category: 'Abstract',         // optional; Abstract|Ambient|Clocks|Digital|Landscapes|Reactive|Space|Water
  description: 'One sentence.',
  fragment: 'shader.glsl',
  uniforms: [ /* see below */ ],
});
```

Types you author against (inlined from the project):

```ts
type UniformType = 'float' | 'int' | 'bool' | 'color' | 'select';
type UniformGroup = 'Motion' | 'Shape' | 'Color';
type UniformColorRole = 'primary' | 'secondary' | 'tertiary' | 'surface' | 'onSurface';

interface UniformManifest {
  name: string; type: UniformType; default: number | boolean | string;
  label?: string; description?: string; group?: UniformGroup; advanced?: boolean;
  min?: number; max?: number; step?: number; unit?: string;
  colorRole?: UniformColorRole; options?: string[];
  visibleWhen?: { name: string; value: number | boolean | string };
  random?: { min: number; max: number } | false;
}
```

Uniform example:

```ts
{ name: 'scale', type: 'float', default: 9, min: 2, max: 24, step: 0.1,
  label: 'Grid density', description: 'Number of grid lines across the short edge.',
  group: 'Shape', random: { min: 5, max: 14 } }
```

Type → GLSL declaration **[!]** (the source must contain `uniform <glsl> <name>;` exactly):

| `type` | GLSL | Runtime value |
|---|---|---|
| `float` | `uniform float name;` | number |
| `int` | `uniform int name;` | rounded number |
| `bool` | `uniform bool name;` | boolean |
| `color` | `uniform vec3 name;` | `#rrggbb` → 0–1 RGB |
| `select` | `uniform int name;` | index into `options` |

### Rules **[!]**

1. Unique `name`; every uniform has non-empty `label`, `description`, and a `group` (**at least three groups used**).
2. `float`/`int`: finite `min`/`max`, `step > 0`, `default` inside the range **and step-aligned** (`min + k·step`).
3. `random` inside `[min, max]` and step-aligned; use `random: false` for backgrounds/audio dials.
4. **Every uniform must be referenced in `main()` and visibly change the output** — the suite diffs each control's endpoints/options (unused uniforms are compiler-dropped and rejected).
5. `visibleWhen.value` must match the parent's type: option string for `select`, boolean for `bool`, number for numbers.
6. Numeric endpoints must render at `uTime = 86400` with no GL error: guard divisions, clamp, never emit NaN/Inf.
7. Always include: `speed` (Motion, `min: 0`), `brightness` (Color), `saturation` (Color, `min: 0`, `max ≥ 2`).

### Colors

Set `colorRole` on every `color` uniform. Reference fallback if omitted: `color/color1/midtone`→primary, `color2`→secondary, `color3`→tertiary, `color4/highlight`→onSurface, `background/backgroundTop/shadow`→surface. Use descriptive labels ("Line color", "Lower sky"). If a shader has a `palette` select with an original/custom split, add top-level `schemePalette: 'custom'` and gate the colors with `visibleWhen: { name: 'palette', value: 'custom' }`.

## Output tail **[!]**

```glsl
vec2 p = (2.0 * gl_FragCoord.xy - uResolution.xy) / min(uResolution.x, uResolution.y); // short-edge aspect
float t = uTime * speed;
// ... compute `col` (vec3) ...
col *= brightness;
col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, saturation);
float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
gl_FragColor = vec4(clamp(col + (dither - 0.5) / 255.0, 0.0, 1.0), 1.0);
```

- `saturation == 0` must be **exactly** `r == g == b` on every pixel. The scalar dither above is added equally to all channels, so grayscale survives — a per-channel dither would fail.
- Dither must be **static** (fragcoord-based, never `uTime`) so paused frames stay byte-identical.
- Clamp before writing.

## Complete example

`manifest.ts`

```ts
import { manifest } from '../../../shared/manifest';

export const moireGridManifest = manifest({
  id: 'moire-grid', title: 'Moiré Grid', category: 'Abstract',
  description: 'Interfering grids drift into slow moiré bands.', fragment: 'shader.glsl',
  uniforms: [
    { name: 'speed', type: 'float', default: 0.5, min: 0, max: 2, step: 0.01,
      label: 'Speed', description: 'Overall animation speed; zero freezes all movement.',
      group: 'Motion', random: { min: 0.1, max: 0.8 } },
    { name: 'scale', type: 'float', default: 9, min: 2, max: 24, step: 0.1,
      label: 'Grid density', description: 'Number of grid lines across the short edge.',
      group: 'Shape', random: { min: 5, max: 14 } },
    { name: 'brightness', type: 'float', default: 1, min: 0.2, max: 2, step: 0.01,
      label: 'Brightness', description: 'Overall light intensity.', group: 'Color' },
    { name: 'saturation', type: 'float', default: 1, min: 0, max: 2, step: 0.01,
      label: 'Saturation', description: 'Color intensity; zero is grayscale.', group: 'Color', advanced: true },
    { name: 'color', type: 'color', default: '#ff7ac6',
      label: 'Line color', description: 'Color of the brighter grid bands.', group: 'Color', colorRole: 'primary' },
    { name: 'background', type: 'color', default: '#0b0f1a',
      label: 'Background', description: 'Color behind the grid.', group: 'Color', colorRole: 'surface', random: false },
  ],
});
```

`shader.glsl`

```glsl
precision highp float;
uniform float speed;
uniform float scale;
uniform float brightness;
uniform float saturation;
uniform vec3 color;
uniform vec3 background;
uniform vec2 uResolution;
uniform float uTime;

void main() {
  vec2 p = (2.0 * gl_FragCoord.xy - uResolution.xy) / min(uResolution.x, uResolution.y);
  float t = uTime * speed;
  p += 0.35 * vec2(sin(t * 0.21), cos(t * 0.17));
  float pattern = 0.5 + 0.5 * sin(sin(p.x * scale) * sin(p.y * scale) * 6.28318 + t * 0.6);
  vec3 col = mix(background, color, pattern);
  col *= brightness;
  col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, saturation);
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  gl_FragColor = vec4(clamp(col + (dither - 0.5) / 255.0, 0.0, 1.0), 1.0);
}
```

## Checklist (verify by inspection)

- [ ] Two files under `src/renderer/shaders/<id>/`; folder == `manifest.id`; one manifest export, first in file.
- [ ] GLSL ES 1.00; `precision highp float;`; `gl_FragColor`; no textures/passes/dynamic loops.
- [ ] `uniform <type> <name>;` present for every control, and every control used in `main()` and visibly affects output.
- [ ] All motion via `uTime * speed`; `speed: 0` freezes exactly; `speed` used for nothing else.
- [ ] `saturation: 0` exactly grayscale; dither static and scalar; output clamped; endpoints safe at `uTime = 86400`.
- [ ] Labels, descriptions, and groups on every uniform; ≥3 groups; `speed`/`brightness`/`saturation` present.
- [ ] Numeric ranges valid and step-aligned; `random` inside range; backgrounds/audio dials `random: false`.
- [ ] `visibleWhen` value types match their parent; every color has an explicit `colorRole`.
- [ ] Short-edge aspect normalization.

## Optional: audio-reactive shaders

Use the shared factory (category becomes `Reactive`):

```ts
import { reactiveManifest } from '../../reactive-manifest';

export const myReactiveManifest = reactiveManifest(
  'reactive-my-effect', 'My Effect', 'One sentence describing the ambient motion.',
  ['#85677f', '#bf9075', '#14121c'],  // color1, color2, background
);
```

It provides `speed`, `sensitivity` ("Audio influence"), `audioLight`, `audioShape`, `shapeDetail`, `scale`, `brightness`, `color1`, `color2`, `background`, `saturation`. Requirements **[!]**: audio causes a visible-but-restrained pixel change, still present at `speed: 0`, and exactly zero at `sensitivity: 0`.

## If you have repo access

```sh
npm run typecheck && npm test && npm run check-shaders
npm start -- --preview --shader <id>
```

Also add the manifest to the array in `tests/shader-manifests.test.ts`; optionally `featuredIds` in `src/settings/index.ts` and a row in `docs/shader-parameters.md`. Never hand-edit `src/renderer/shaders/generated.ts`.
