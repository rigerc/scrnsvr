---
name: shadereye
description: Use the shadereye MCP server to validate, render, visually debug, probe, diff, browser-test, translate, and research GLSL/WGSL/HLSL shaders. Trigger for shader compilation errors, wrong-looking output, Shadertoy/WebGL mismatches, shader regression tests, cross-language translation, or requests to inspect shader pixels/expressions.
---

# Shadereye MCP — Shader Perception and Debugging

Use the `shadereye` MCP tools as the execution and perception layer for shader work. Do not reason about shader correctness from source alone when a tool can compile, render, probe, diff, or execute it.

## Core operating rule

For shader debugging, prefer a tight evidence loop:

1. **Validate** the current source.
2. **Render** it and inspect the returned image.
3. **Localize** the problem with expression visualization and/or pixel probes.
4. **Look up** a language/runtime gotcha when evidence suggests one.
5. **Edit** the shader.
6. **Re-render** and, when useful, **diff** before vs. after.
7. Use **browser execution** when WebGL/Shadertoy/runtime behavior matters.

Do not claim that a shader is visually correct because validation passes. Static validation and runtime/browser behavior catch different classes of failures.

## Tool routing

Use the narrowest tool that answers the question:

- `validate_shader` — syntax/type/static validation; start here for compile failures or unknown shader health.
- `render_shader` — default visual check for a single frame.
- `render_animation` — time-dependent behavior, motion, loops, temporal artifacts.
- `visualize_expression` — inspect an intermediate scalar/vector spatially.
- `probe_pixels` — exact RGBA values at specific coordinates plus a crop.
- `diff_shaders` — regression testing or before/after comparison.
- `run_in_browser` — WebGL2/GLSL ES runtime ground truth, driver compile logs, console errors, GL errors, screenshot.
- `translate_shader` — GLSL/WGSL/HLSL/SPIR-V translation.
- `lookup_reference` — bundled GLSL/WGSL/Shadertoy reference and common gotchas.
- `shadertoy_get` — fetch shader source by Shadertoy ID or URL.
- `shadertoy_search` — discover Shadertoy shader IDs by query.

See `references/tool-reference.md` for exact arguments, defaults, and limitations.

## Default debugging workflow

### 1. Establish the source of truth

Use the exact shader source the user wants tested. If the source lives in a project file, read that file rather than reconstructing it from memory.

Preserve the shader's intended language and runtime assumptions. If language is obvious, pass it explicitly where supported; otherwise allow shadereye to detect it.

### 2. Validate first

Call `validate_shader` before rendering when:

- the shader is new or recently edited;
- the user reports a compile error;
- the language is uncertain;
- rendering failed;
- translation produced new source.

Read structured line/column errors and warnings. Fix deterministic compiler errors before speculative visual debugging.

### 3. Render and inspect visually

Use `render_shader` as the normal first visual test. Keep resolution modest while iterating; increase it only when the artifact depends on fine spatial detail.

The native backend is the default because it is fast and deterministic. Treat the returned PNG as evidence: describe what is actually visible before proposing a fix.

For time-dependent shaders, pass an explicit `time`. If the problem is temporal, use `render_animation` with a meaningful `t0`, `t1`, and frame count rather than judging one frame.

### 4. Localize visual bugs

Choose one or both:

**Expression visualization**

Use `visualize_expression` to inspect internal math without manually rewriting the entire output path. Good targets include:

- signed distance values;
- normals;
- UVs;
- masks;
- lighting terms;
- noise values;
- iteration counts or normalized depth.

Mapping guidance:

- scalar → `grayscale` or `heatmap`;
- vec2 → `rg`;
- vec3 color/vector → `rgb`;
- direction or values that need remapping → `normalized`.

**Pixel probing**

Use `probe_pixels` when the issue can be tested at known coordinates: center, corners, edges, suspected discontinuities, or points mentioned by the user. Prefer a small set of diagnostic coordinates over a large arbitrary list.

### 5. Use references only after forming a hypothesis

Call `lookup_reference` with a focused term such as:

- `integer division`
- `smoothstep`
- `precision`
- `derivatives`
- `matrix order`
- `coordinate system`

Use the returned reference to confirm or reject a hypothesis; do not substitute generic reference lookup for rendering and inspection.

### 6. Browser-test when runtime fidelity matters

Use `run_in_browser` when any of these apply:

- the shader works natively but fails in Shadertoy or WebGL;
- GLSL ES precision rules may matter;
- the user specifically targets browser/WebGL2 behavior;
- driver compile/link output is needed;
- console or `gl.getError()` evidence is needed.

Inspect `compiled_ok`, console messages, exceptions, GL errors, and the screenshot together. A clean native render does not prove clean WebGL2 execution.

### 7. Verify the fix

After editing:

1. validate again;
2. render again;
3. compare the new output to the intended behavior;
4. use `diff_shaders` when the task has an objective visual baseline or when a small change should preserve most pixels.

When reporting the result, separate:

- what the tools directly showed;
- the inferred root cause;
- the code change;
- the verification evidence.

## Regression testing with `diff_shaders`

Use `diff_shaders` for changes that should be pixel-identical or close within a tolerance.

Start with a strict or small tolerance when equivalence is expected. For intentionally approximate translations, anti-aliasing changes, or backend differences, choose a tolerance appropriate to the user's acceptance criteria rather than inventing one silently.

Important: current `diff_shaders` renders both sources at time `0`, auto-detects language, and does not expose a per-source time parameter. Do not use it as proof of equivalence for animations unless the task specifically concerns the time-zero frame.

## Translation workflow

For language conversion:

1. `validate_shader` the original.
2. `translate_shader` with explicit `from` and `to`.
3. `validate_shader` the translated output.
4. `render_shader` both versions at matching dimensions/time when both are renderable.
5. Optionally `diff_shaders` for a time-zero pixel comparison.
6. If the target is WebGL/GLSL ES, use `run_in_browser` on the target.

Do not present translation success as semantic equivalence until validation and rendering support that conclusion.

## Shadertoy workflow

If the user provides a Shadertoy ID or URL:

1. call `shadertoy_get`;
2. inspect the returned adapted image-pass code;
3. validate/render it;
4. use browser execution if Shadertoy/WebGL fidelity matters.

If only a concept or title is known, use `shadertoy_search`, then fetch the relevant ID.

`shadertoy_get` and `shadertoy_search` require `SHADERTOY_API_KEY`; all other shadereye tools work without it. If the key is missing, continue with non-Shadertoy tools instead of blocking unrelated shader work.

## Practical constraints

- Default render size is 512×512. Use smaller dimensions for rapid iteration when detail permits.
- `render_shader` defaults to `time = 0`.
- `render_animation` defaults `t0 = 0`, `t1 = 0`, so set a nonzero interval for actual animation inspection.
- `probe_pixels` currently renders at time `0`.
- `diff_shaders` currently renders at time `0` and does not take explicit language arguments.
- `run_in_browser` uses a system Chrome/Chromium WebGL2 pipeline; browser availability is an environment dependency.
- `visualize_expression` is intended for GLSL sub-expressions.

Do not hide these constraints when they materially limit a conclusion.

## Failure handling

If a tool returns `ok: false`:

- report the tool error faithfully;
- do not fabricate an image/result;
- check language, source shape, runtime assumptions, and environment dependencies;
- use `validate_shader` or `lookup_reference` to narrow the failure;
- fall back from browser-specific checks to native checks only when the user can still make progress from them.

If browser execution fails because Chrome/Chromium is unavailable, state that browser-runtime verification was not completed; do not treat native rendering as identical evidence.

## Response discipline

For shader debugging answers, prefer this compact structure:

- **Observed:** concrete validation/render/browser evidence.
- **Cause:** the most supported explanation.
- **Change:** exact code or conceptual fix.
- **Verified:** what was re-run and what improved/passed.

Avoid long speculative shader tutorials unless the user asks for them.
