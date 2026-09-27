# Shadereye MCP Tool Reference

This reference reflects the current `zajalist/shadereye` MCP server source on its `main` branch.

## `validate_shader`

Purpose: static shader validation with structured diagnostics.

Arguments:

```json
{
  "source": "<shader source>",
  "lang": "glsl | wgsl | hlsl | spirv" // optional
}
```

Notes:
- `lang` is optional; the implementation attempts detection when omitted.
- Use before rendering after edits or translations.

## `render_shader`

Purpose: render a single frame to PNG.

Arguments:

```json
{
  "source": "<shader source>",
  "lang": "glsl | wgsl | hlsl | spirv", // optional
  "width": 512,
  "height": 512,
  "time": 0.0
}
```

Defaults: `width=512`, `height=512`, `time=0`.

Returns JSON summary plus an `image/png` content block on success.

## `render_animation`

Purpose: render multiple times as a horizontal filmstrip/contact sheet.

Arguments:

```json
{
  "source": "<shader source>",
  "lang": "glsl | wgsl | hlsl | spirv", // optional
  "width": 512,
  "height": 512,
  "t0": 0.0,
  "t1": 2.0,
  "frames": 8
}
```

Defaults: `width=512`, `height=512`, `t0=0`, `t1=0`, `frames=8`.

Important: with default `t0 == t1`, all frames represent the same time. Set an explicit nonzero range for temporal debugging.

## `visualize_expression`

Purpose: render an arbitrary GLSL sub-expression as color.

Arguments:

```json
{
  "source": "<GLSL source>",
  "expr": "<expression>",
  "mode": "grayscale | rg | rgb | normalized | heatmap",
  "width": 512,
  "height": 512
}
```

Defaults: `mode` falls back to grayscale for unrecognized/empty values; `width=512`, `height=512`.

Implementation mode mapping:
- `rg` → vec2 RG
- `rgb` → vec3 RGB
- `normalized` → normalized mapping
- `heatmap` → heatmap
- anything else → grayscale float

## `probe_pixels`

Purpose: exact pixel RGBA values plus a zoomed crop.

Arguments:

```json
{
  "source": "<shader source>",
  "lang": "glsl | wgsl | hlsl | spirv", // optional
  "width": 512,
  "height": 512,
  "coords": [[256, 256], [0, 0]]
}
```

Defaults: `width=512`, `height=512`, `coords=[]`.

Current limitation: render time is fixed to `0.0`.

## `diff_shaders`

Purpose: render and pixel-diff two shader sources.

Arguments:

```json
{
  "source_a": "<shader A>",
  "source_b": "<shader B>",
  "width": 512,
  "height": 512,
  "tol": 0.0
}
```

Defaults: `width=512`, `height=512`, `tol=0`.

Returns diff metrics and highlighted diff PNG.

Current limitations:
- render time is fixed to `0.0`;
- language is auto-detected; there are no explicit `lang_a`/`lang_b` parameters.

## `translate_shader`

Purpose: translate across supported shader languages.

Arguments:

```json
{
  "source": "<shader source>",
  "from": "glsl | wgsl | hlsl | spirv",
  "to": "glsl | wgsl | hlsl | spirv"
}
```

Language aliases: `spv` is accepted internally as SPIR-V.

Always validate and render translated output before claiming equivalence.

## `run_in_browser`

Purpose: execute in headless system Chromium using WebGL2 / GLSL ES runtime behavior.

Arguments:

```json
{
  "source": "<shader source>",
  "width": 512,
  "height": 512,
  "frames": 16
}
```

Defaults: `width=512`, `height=512`, `frames=16`.

Returns:
- `compiled_ok`
- captured console entries
- uncaught exceptions
- GL errors
- screenshot PNG

Use for Shadertoy/WebGL fidelity and runtime/driver diagnostics. Requires Chrome/Chromium; `SHADEREYE_BROWSER` can point to a browser binary.

## `shadertoy_get`

Purpose: fetch a Shadertoy shader by ID or URL.

Arguments:

```json
{
  "id_or_url": "<Shadertoy ID or URL>"
}
```

Returns shader metadata and adapted image-pass source.

Requires `SHADERTOY_API_KEY`.

## `shadertoy_search`

Purpose: search Shadertoy for matching shader IDs.

Arguments:

```json
{
  "query": "<search terms>"
}
```

Requires `SHADERTOY_API_KEY`.

## `lookup_reference`

Purpose: search the bundled offline GLSL/WGSL/Shadertoy reference and gotcha database.

Arguments:

```json
{
  "query": "<focused term>"
}
```

Good queries are specific: `integer division`, `precision`, `smoothstep`, `derivatives`, `matrix multiplication`, `Shadertoy uniforms`.

## Recommended routing patterns

### Compile error
`validate_shader` → edit → `validate_shader` → `render_shader`

### Looks wrong
`render_shader` → `visualize_expression` and/or `probe_pixels` → `lookup_reference` if needed → edit → `render_shader`

### Works locally, fails in Shadertoy/WebGL
`validate_shader` → `render_shader` → `run_in_browser` → `lookup_reference` → edit → `run_in_browser`

### Regression check
`validate_shader` both → `diff_shaders` → inspect metrics/diff image

### Translation
`validate_shader` source → `translate_shader` → `validate_shader` target → render both → optional `diff_shaders` → target runtime test
