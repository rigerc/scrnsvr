# Authoring a shader for scrnsvr (stand-alone briefing)

**You are writing one new shader for scrnsvr**, a shader-based idle screensaver (Electron + OGL/WebGL). You have no access to the repository. This document is the complete contract: everything below is self-contained, and the rules marked **[enforced]** are what an automated check suite will apply to your output. Follow them by inspection.

Your deliverable is the full text of **two files**:

```
src/renderer/shaders/<id>/
├── manifest.ts    # TypeScript: metadata + controls
└── shader.glsl    # GLSL ES 1.00 fragment shader
```

`<id>` is a lowercase kebab-case slug (e.g. `moire-grid`). It **must** equal the folder name.

There is no registration step: a build script scans `src/renderer/shaders/*/`, imports each folder's `manifest.ts` + `shader.glsl`, and generates the registry. Imported/provenance shaders are handled by a separate pipeline — do not touch that; you are adding an original built-in shader.

> **Note:** end users can also paste arbitrary GLSL in the app's Settings window (a single-pass `mainImage(out vec4, in vec2)` / `main()` source with `iTime`/`iResolution` aliases). That is a different surface. This document is only for adding a shader to the shipped collection.

---

## 1. Platform and language

- Target: **raw WebGL 1 and WebGL 2**, fragment shader only. The engine supplies the vertex shader and a fullscreen triangle.
- Write **GLSL ES 1.00**. The same source is compiled in a `webgl` context and a `webgl2` context.
  - ❌ no `#version 300 es`, no `in`/`out` qualifiers, no `texture()`
  - ✅ `precision highp float;` at the top, write to `gl_FragColor`, use `gl_FragCoord`
- **No textures, no samplers, no multipass buffers, no `iChannel` inputs, no framebuffers.** Everything must be procedural and single-pass.
- WebGL 1 restrictions: **no non-constant loop bounds and no dynamic array indexing**. Prefer analytic functions or unroll loops.
- Keep fragment cost modest: these render at up to 1080p (and higher) on idle desktops, and the suite records readback time at 1920×1080.

---

## 2. Engine-supplied uniforms

The runtime binds these before every draw. Declare only the ones you use.

| Uniform | Type | Meaning |
|---|---|---|
| `uTime` | `float` | Animation time in seconds. For built-ins this is the *integrated* phase (`Σ dt · speed`) — see §3. |
| `uResolution` | `vec2` | Drawing-buffer size in pixels. |
| `uDate` | `vec4` | `(year, month, day, secondsSinceMidnight)` — for clock faces. |
| `uAudio` | `vec4` | `(low, mid, high, level)`, each 0–1. Referencing `uAudio` in the source makes the app subscribe to audio capture automatically. |

There are no other engine uniforms. Any other input you want must be a control you declare in the manifest and read in the shader as a `uniform`.

---

## 3. Time and speed — the most common failure

Every shader has a `speed` control. **[enforced]** The check suite drives `uTime` directly and expects `speed` to scale time, so:

- Hoist `float t = uTime * speed;` and route **every** time-dependent term through `t`.
- The suite renders at `uTime = 0` and `uTime = 100` with `speed = 0` and requires a **byte-identical** frame. Any animation term that ignores `speed` fails this.
- In the real app the runtime *already* folds `speed` into `uTime` and passes `speed = 1` to the GPU. So `uTime * speed` reads as "artistic phase", and editing speed never jumps or reverses the composition; pausing holds the current frame. This means **`speed` must only ever multiply time.** If you want a control that scales amplitude/size, give it its own name.
- Frame gaps from system suspend are discarded by the engine. Do not attempt to compensate against wall-clock time.

**Reactive (audio) shaders are the deliberate exception:** audio response may continue at `speed = 0`. Drive that from a separate `sensitivity`/`audio*` control and never multiply audio by `speed`.

---

## 4. Manifest schema

The `manifest.ts` file imports a typed identity helper and must export exactly **one** const, as the **first** `export const` in the file (the registry generator matches the first occurrence).

Inline copy of the shared types (author against these):

```ts
export const shaderCategories =
  ['Abstract', 'Ambient', 'Clocks', 'Custom', 'Digital', 'Landscapes', 'Reactive', 'Space', 'Water'] as const;
export type ShaderCategory = typeof shaderCategories[number];

export type UniformType = 'float' | 'int' | 'bool' | 'color' | 'select';
export type UniformValue = number | boolean | string;
export type UniformGroup = 'Motion' | 'Shape' | 'Color';
export type UniformColorRole = 'primary' | 'secondary' | 'tertiary' | 'surface' | 'onSurface';

export interface UniformManifest {
  name: string;
  type: UniformType;
  default: UniformValue;
  label?: string;
  description?: string;
  group?: UniformGroup;
  advanced?: boolean;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  colorRole?: UniformColorRole;
  options?: string[];
  visibleWhen?: { name: string; value: UniformValue };
  random?: { min: number; max: number } | false;
}

export interface ShaderManifest {
  id: string;
  title: string;
  category?: ShaderCategory;
  description?: string;
  uniforms: UniformManifest[];
  fragment: string;
  schemePalette?: string;
}

export const manifest = (value: ShaderManifest): ShaderManifest => value;
```

For a normal shader, the file starts:

```ts
import { manifest } from '../../../shared/manifest';

export const moireGridManifest = manifest({
  id: 'moire-grid',          // must equal the folder name
  title: 'Moiré Grid',
  category: 'Abstract',      // optional; defaults to 'Abstract'
  description: 'Interfering grids drift into slow moiré bands.',
  fragment: 'shader.glsl',   // always this value
  uniforms: [ /* ... */ ],
});
```

### Manifest-level fields

| Field | Notes |
|---|---|
| `id` | Config key **and** folder name. Must be kebab-case and identical to the folder. |
| `title` | Human name shown in the gallery. |
| `category` | One of the nine above. `Custom` is reserved for user-pasted shaders — never use it for a shipped folder. `Reactive` is produced by the helper in §8. |
| `description` | One short sentence. |
| `fragment` | Always `'shader.glsl'`. |
| `schemePalette` | Optional. Name of one option in a `select` uniform that is named `palette`. When set, choosing a color scheme switches that select to this option (used to reveal scheme-driven colors, e.g. `'custom'`). |

### Uniform entry example

```ts
{
  name: 'scale',                       // must exactly match `uniform float scale;`
  type: 'float',
  default: 9,
  min: 2, max: 24, step: 0.1,          // required for float/int
  label: 'Grid density',
  description: 'Number of grid lines across the short edge.',
  group: 'Shape',                      // Motion | Shape | Color
  advanced: false,                     // true = hidden behind an "Advanced" disclosure
  unit: '°',                           // optional display suffix
  colorRole: 'primary',                // color uniforms only
  options: ['original', 'custom'],     // select only
  visibleWhen: { name: 'palette', value: 'custom' }, // conditional visibility
  random: { min: 5, max: 14 },         // conservative randomize window; `false` locks it
}
```

### Type → GLSL declaration mapping **[enforced]**

The suite asserts the shader source contains the exact declaration `uniform <glsl> <name>;`.

| Manifest `type` | GLSL declaration | Value passed at runtime |
|---|---|---|
| `float` | `uniform float name;` | number |
| `int` | `uniform int name;` | number, rounded |
| `bool` | `uniform bool name;` | boolean |
| `color` | `uniform vec3 name;` | `#rrggbb` hex → linear 0–1 RGB (no sRGB conversion) |
| `select` | `uniform int name;` | index into `options` (0-based) |

---

## 5. Manifest rules **[enforced]**

1. **One exported manifest const, matched first.** No helper `export const` before it.
2. **Unique `name` per uniform.**
3. Every uniform has a **non-empty `label` and `description`**, and a `group` of `Motion`, `Shape`, or `Color`. The settings UI also requires **at least three visible groups**.
4. For `float`/`int`: `min` and `max` are finite, `step > 0`, and `default` lies inside `[min, max]` **and is aligned to `step`** (i.e. `min + k·step`).
5. `random`, when present, must satisfy `min ≤ random.min ≤ random.max ≤ max` and be step-aligned. Use `random: false` for controls that must not move (backgrounds, audio dials).
6. **Every declared uniform must actually affect the output.** The suite renders each control's endpoints/options and rejects any whose frames do not differ. A declared-but-unused uniform also fails (`unused uniform <name>`) because the compiler drops it and no location exists.
7. `visibleWhen.value` must match the parent control's **type**: an option string for `select`, a boolean for `bool`, a number for `float`/`int`. A mismatch hides the control forever.
8. **Numeric endpoints must render safely** at `uTime = 86400` with no GL error. Guard divisions (`max(x, ε)`), and clamp outputs. Never produce NaN/Inf.
9. Every shader must expose the three standard controls:
   - `speed` — `type: 'float'`, group `Motion`, `min: 0`
   - `brightness` — `type: 'float'`, group `Color`
   - `saturation` — `type: 'float'`, group `Color`, `min: 0`, `max` ≥ 2
   (Imported shaders additionally need `contrast`; original shaders do not.)

---

## 6. Colors and color schemes

Global and per-shader **color schemes** (30 terminal-derived palettes) and the **Noctalia import** rewrite every `color` uniform through a role map.

- Set `colorRole` explicitly: `primary`, `secondary`, `tertiary`, `surface`, `onSurface`.
- If omitted, the role is *inferred from the name* (compatibility fallback only):

  | Name | Inferred role |
  |---|---|
  | `color`, `color1`, `midtone` | `primary` |
  | `color2` | `secondary` |
  | `color3` | `tertiary` |
  | `color4`, `highlight` | `onSurface` |
  | `background`, `backgroundTop`, `shadow` | `surface` |

  Anything else falls through to `primary → secondary → tertiary` by position.
- Prefer descriptive labels ("Line color", "Lower sky") over generic "Primary color", and describe the material in `description`.
- If the shader has a `palette` select with an `original`/`custom` split, set `schemePalette: 'custom'` and gate the color uniforms with `visibleWhen: { name: 'palette', value: 'custom' }`.

---

## 7. Visual conventions

### Aspect ratio
Normalize coordinates by the **short edge** so portrait and ultrawide both read well (the suite tests 640×360, 360×640, 180×90 and 960×270):

```glsl
vec2 p = (2.0 * gl_FragCoord.xy - uResolution.xy) / min(uResolution.x, uResolution.y);
```

### Output tail (do this last)
Apply brightness as intensity (match the shader's own color path — multiplicative or exponential — and do not introduce a blanket gamma change), then desaturate, then add a **static** dither, then clamp:

```glsl
col *= brightness;
col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, saturation);
float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
gl_FragColor = vec4(clamp(col + (dither - 0.5) / 255.0, 0.0, 1.0), 1.0);
```

- **[enforced]** `saturation == 0` must produce **exactly** grayscale: `r == g == b` for every pixel. The dot-product luminance form above guarantees it. The dither is a single scalar added equally to all three channels, so grayscale survives — a per-channel dither would fail.
- **[enforced]** The dither must be **static** (based on `gl_FragCoord`, never `uTime`), so a paused frame stays byte-identical.
- **[enforced]** Clamp before writing; out-of-range or NaN output trips GL-error/endpoint checks.

### Motion
Everything that moves must be a function of `t = uTime * speed` (§3). Bounded, continuous motion is preferred over jumps; avoid hard cuts that make the zero-speed and pause checks non-deterministic.

---

## 8. Optional: reactive (audio) shaders

Reactive shaders live in category `Reactive` and use a shared factory instead of a hand-written manifest. Its signature and the exact uniforms it produces:

```ts
import { reactiveManifest } from '../../reactive-manifest';

export const myReactiveManifest = reactiveManifest(
  'reactive-my-effect',                         // id (== folder name)
  'My Effect',                                  // title
  'One sentence describing the ambient motion.',// description
  ['#85677f', '#bf9075', '#14121c'],            // [color1, color2, background] defaults
);
```

Produced uniforms (all `float`, groups as noted): `speed` (Motion), `sensitivity` (Motion, "Audio influence"), `audioLight` (Color, advanced), `audioShape` (Motion, advanced), `shapeDetail` (Shape), `scale` (Shape), `brightness` (Color), `color1` (Color, primary), `color2` (Color, secondary), `background` (Color, surface), `saturation` (Color, advanced).

Audio-specific checks **[enforced]**:
- The pixel delta between silence and loud audio must be **visible but restrained** (small but non-zero).
- The response must remain present at `speed: 0`.
- It must vanish entirely at `sensitivity: 0`.

Use the `uAudio` vec4 directly, smooth it, and gate its magnitude by `sensitivity` and the `audioLight`/`audioShape` dials.

---

## 9. Complete worked example

`src/renderer/shaders/moire-grid/manifest.ts`

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

`src/renderer/shaders/moire-grid/shader.glsl`

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
  float t = uTime * speed;                          // speed only ever scales time
  p += drift * vec2(sin(t * 0.21), cos(t * 0.17));  // bounded wander at every endpoint
  float pattern = sin(p.x * scale) * sin(p.y * scale);
  pattern = 0.5 + 0.5 * sin(pattern * 6.28318 + t * 0.6);
  vec3 col = mix(background, color, pattern);
  col *= brightness;
  col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, saturation);
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  gl_FragColor = vec4(clamp(col + (dither - 0.5) / 255.0, 0.0, 1.0), 1.0);
}
```

---

## 10. Self-review checklist

Because you cannot run the repository's tooling, verify each item by reading your own output. These are exactly the conditions the automated suite enforces.

**Packaging**
- [ ] Two files, in `src/renderer/shaders/<id>/`, where `<id>` equals `manifest.id`, kebab-case.
- [ ] `manifest.ts` exports exactly one const, and it is the **first** `export const`.
- [ ] `fragment` is `'shader.glsl'`; category is one of the nine and is not `Custom`.

**Shader source**
- [ ] Begins with `precision highp float;`; uses GLSL ES 1.00 (`gl_FragColor`, no `#version`, no `in`/`out`, no `texture()`).
- [ ] No samplers, textures, passes, non-constant loop bounds, or dynamic array indexing.
- [ ] Contains the exact declaration `uniform <type> <name>;` for **every** manifest uniform, and references each one in `main()`.
- [ ] All animation flows through `uTime * speed`; `speed` is used for nothing else.
- [ ] `saturation == 0` yields exactly `r == g == b` on every pixel.
- [ ] Dither is static (fragcoord-based) and added equally to all channels.
- [ ] Output is clamped; no NaN/Inf; no division by zero at any numeric endpoint.
- [ ] Aspect normalized by the short edge.
- [ ] Bounded cost (no giant unrolled loops at 1080p).

**Manifest**
- [ ] Every uniform has non-empty `label` + `description` + a valid `group`; at least three groups are used.
- [ ] `speed` (Motion, min 0), `brightness` and `saturation` (Color) are present; `saturation.min == 0`.
- [ ] All `float`/`int` have finite `min`/`max`, `step > 0`, and a step-aligned `default` inside the range.
- [ ] All `random` ranges are inside `[min, max]` and step-aligned; backgrounds/audio dials use `random: false`.
- [ ] Each control's endpoints/options produce visibly different frames.
- [ ] `visibleWhen.value` type matches its parent control's type.
- [ ] Every `color` has an explicit `colorRole`; a `palette` select with an original/custom split sets `schemePalette`.

**Optional: reactive**
- [ ] Built with `reactiveManifest(...)`; audio response visible, restrained, present at `speed: 0`, and zero at `sensitivity: 0`.

---

## 11. If you *do* have repo access

Only relevant to whoever integrates the files; ignore if you are a disconnected agent.

```sh
npm run typecheck        # regenerates the shader registry, then typechecks
npm test                 # manifest/parameter contracts and runtime
npm run check-shaders    # real Chromium/WebGL: WebGL1 + WebGL2, all enforced rules
npm start -- --preview --shader moire-grid
```

Additional integration steps, if you have the tree:

- Add the manifest to the array in `tests/shader-manifests.test.ts` (the parameter-contract test uses an explicit list).
- Optionally add the id to `featuredIds` in `src/settings/index.ts` to pin it to the Featured row.
- Add a row describing its controls to the table in `docs/shader-parameters.md`.
- Do **not** hand-edit `src/renderer/shaders/generated.ts` — it is generated.
