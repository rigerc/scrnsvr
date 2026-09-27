# Authoring shaders with the shadereye MCP

How to use the `shadereye` MCP server as a **look-development loop** while writing a shader
for scrnsvr. Read [authoring-shaders.md](authoring-shaders.md) first for the scrnsvr
contract itself (files, manifest, GLSL ES 1.00 rules, `check-shaders`); this document only
covers the shadereye half of the workflow.

**Scope and the one rule that matters most:** shadereye is fast, local, and disposable —
it renders 512×512 in under a second, so you can iterate on *composition* ten times before
touching the repo. It is **not a gate**. It cannot check any of the rules
`npm run check-shaders` enforces (freeze at `speed: 0`, exact grayscale, unused uniforms,
`uTime = 86400` endpoint safety, WebGL 1 *and* 2 compilation, portrait/ultrawide, readback
cost). A shader that looks perfect in shadereye can still fail the build. Budget for the
port as the real work.

The status matrix in §2 was measured on 2026-09-27 with the servers listed in `.mcp.json`.
Re-check it if the install changes.

## TL;DR workflow

```
idea → Shadertoy-dialect prototype (consts, not uniforms)
     → render_shader / render_animation      (iterate the look)
     → render at 360×640 and 960×270         (framing in portrait / ultrawide)
     → probe_pixels                          (exact values where it matters)
     → diff_shaders                          (A/B a tweak and read the numbers)
     → PORT to the scrnsvr contract
     → npm run typecheck && npm test && npm run check-shaders   ← the actual gate
```

## 1. The dialect gap (this is what breaks first)

shadereye's renderer speaks **Shadertoy**. scrnsvr speaks **GLSL ES 1.00 with engine
uniforms**. They are not interchangeable, and the failure mode is nasty: a shader in the
scrnsvr dialect does not error in shadereye, it **hangs until the request times out**.

| | shadereye (prototype) | scrnsvr (`shader.glsl`) |
|---|---|---|
| Entry point | `void mainImage(out vec4 fragColor, in vec2 fragCoord)` | `void main()` |
| Output | `fragColor` | `gl_FragColor` |
| Pixel size | `iResolution` (vec3) | `uResolution` (vec2) |
| Time | `iTime` (seconds, supplied by the tool) | `uTime` (integrated phase) × `speed` |
| Knobs | **must be `const`/literals** — see below | `uniform`s declared in `manifest.ts` |
| Extra inputs | `iDate` / `iChannel` unsupported (hang) | `uDate` (clocks), `uAudio` (reactive) |

Two consequences to internalise:

- **Never paste `shader.glsl` into shadereye.** A minimal `precision highp float;` +
  `uniform float uTime;` + `gl_FragColor` source times out. Verified twice in the
  batch-1 session and again on 2026-09-27.
- **Prototype knobs as `const float`, not `uniform float`.** `render_shader` only binds
  `iTime` and `iResolution`; any uniform you declare is left unset and reads as `0`, which
  usually renders black. So expose knobs as named consts and change the values by editing
  the source between renders. GLSL ES 1.00 has no uniform initializers, so there is no way
  around this.

Write the prototype so the port is mechanical:

```glsl
// ---- prototype: Shadertoy dialect, knobs as consts ---------------------------
const float gridFrequency = 30.0;   // -> uniform float gridFrequency;
const float lineWidth     = 0.09;   // -> uniform float lineWidth;
const float angleSpread   = 0.045;  // -> uniform float angleSpread;

float gridLines(vec2 p, float ang, float freq, float w) { /* ... */ }

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 p = (2.0 * fragCoord - iResolution.xy) / min(iResolution.x, iResolution.y);
  float t = iTime;                        // already "phase"; scrnsvr: uTime * speed
  vec3 col = /* ... */;
  fragColor = vec4(col, 1.0);
}
```

Then the port is: rename `mainImage`→`main` and its params, `iResolution`→`uResolution`
(with `.xy`), `iTime`→`uTime * speed`, `fragColor`→`gl_FragColor`, turn each `const` into a
declared uniform, and append the standard brightness/saturation/dither tail from
[authoring-shaders.md](authoring-shaders.md#visual-conventions).

> The scrnsvr runtime also supplies a `varying vec2 vUv` (used by 19 of the 53 shaders).
> It is **not** available in shadereye, so prototype against `fragCoord` / `iResolution`
> and, if you prefer `vUv`, convert at port time (`p = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0)`).

## 2. Tool status (measured 2026-09-27)

| Tool | Status | Use it for |
|---|---|---|
| `render_shader` | ✅ works (backend `Vulkan`) | the main loop; `time` freezes a phase for a deterministic still |
| `render_animation` | ✅ works | a horizontal filmstrip across `t0..t1` — catches strobe, stalls, and period mismatches |
| `probe_pixels` | ✅ works | exact RGBA at coordinates, plus a zoomed crop — for "is this exactly right" questions |
| `diff_shaders` | ✅ works, **but no `time` parameter** | A/B two variants at a single fixed phase; returns `max_abs`, `mean_abs`, `pct_pixels_over_tol`, `passed` |
| `validate_shader` | ❌ **not usable** | parses GLSL/SPIR-V 450 semantics: rejects `iResolution` (`UnknownVariable`) and ES 1.00 (`gl_FragColor`, bare `uniform`). Ignore its output. |
| `run_in_browser` | ❌ **times out** | headless Chromium is not available in this environment. Use `npm run check-shaders` instead. |
| `visualize_expression` | ❌ times out | — |
| `lookup_reference` | ⚠️ returns `{"entries":[],"ok":true}` for every query | the offline reference DB is empty in this install. Harmless to call; do not depend on it. |
| `shadertoy_search` / `shadertoy_get` | ❌ needs `SHADERTOY_API_KEY` | returns `SHADERTOY_API_KEY not set`. Only usable if you configure a key. |
| `translate_shader` | untested | not part of this workflow; scrnsvr is ES 1.00, not WGSL/HLSL/SPIR-V |

### The `diff_shaders` fixed-phase gotcha

`diff_shaders` takes no `time` argument, so it evaluates both sources at the **same fixed
phase (t = 0)**. Two shaders that differ *only* in how they use `iTime` therefore diff as
**identical**:

```
# differ only in `iTime` vs `iTime * 0.5`  ->  max_abs 0, passed true   (useless for this)
# differ in the spatial term (20.0 vs 26.0) ->  max_abs 255, mean_abs 73.2, passed false
```

So use it for **structural** A/B (density, edge hardness, colour ramp, a fixed-value tweak
baked into the source), and use `render_animation` when the thing you changed is
time-dependent.

## 3. Step-by-step

### Step 1 — prototype the look

Write the Shadertoy-dialect source with consts (§1). Get *one* frame right at 512×512
before adding time. Composition first, motion second.

### Step 2 — iterate, then animate

```
render_shader(source, width, height, time)      # stills; set `time` for a fixed phase
render_animation(source, t0, t1, frames)        # 4–8 frames is usually enough
```

Use `render_animation` deliberately — it exposes the failures a single still hides: a
pattern that strobes, a phase that stalls, two motions with mismatched periods, a beat that
never opens. It costs one call and catches what ten stills miss.

### Step 3 — check framing, not just the look

scrnsvr tests **portrait 360×640** and **ultrawide 960×270** as well as 16∶9. shadereye
honours the `width`/`height` you pass, and `iResolution` reflects them, so you can preview
all three shapes directly:

```
render_shader(source, 512, 512)   # 16:9-ish square reference
render_shader(source, 360, 640)   # portrait
render_shader(source, 960, 270)   # ultrawide
```

Short-edge normalisation (`/ min(uResolution.x, uResolution.y)`) is what makes this work;
without it a portrait render crops instead of fitting. Do this **early** — re-framing a
finished composition is much more work than building it in.

### Step 4 — verify exact values

When you need to know a value rather than see it (is the background exactly the colour you
set? does the crack field hit 0 where it should? has an edge blown past 1.0?), use
`probe_pixels` with coordinates. It returns exact RGBA plus a zoomed crop. For a source that
is `vec3 col = vec3(length(p), 0.25, 0.5);` at 256×256:

```
(64,64)   -> [179,64,127,255]    # length(p) ≈ 0.707 -> red ≈ 180
(128,128) -> [1,64,127,255]      # centre: length(p) = 0 -> red 0 (reads 1 from 8-bit rounding)
(200,20)  -> [255,64,127,255]    # corner: length(p) > 1 -> clipped red
```

The green and blue channels are the fixed `0.25` / `0.5`, so any drift there is a real bug.
This is the tool for "the render looks fine, but is the maths right", and for confirming
that an additive highlight has not clipped to flat white across a region.

### Step 5 — A/B a tweak

Change one value, render both, and `diff_shaders` them. `pct_pixels_over_tol` near `0.99`
means you changed essentially everything (probably not a tweak); a few percent means you
touched a local region. Remember the fixed-phase caveat above.

### Step 6 — port to the scrnsvr contract

Convert per §1 and add the manifest. The mechanical checklist for the source:

- [ ] `precision highp float;` is the first line.
- [ ] `void main()` writing `gl_FragColor`.
- [ ] `uniform vec2 uResolution;` and `uniform float uTime;` declared, `speed` declared.
- [ ] Every const knob is now a `uniform` **and** has a matching manifest entry with
      `label`, `description`, `group` (≥ 3 groups used) — see
      [authoring-shaders.md](authoring-shaders.md#the-manifest).
- [ ] Every time-dependent term goes through `float t = uTime * speed;` — including terms
      that were constants in the prototype (e.g. a `+ t * 0.05` rotation).
- [ ] Standard tail appended: `brightness`, then `saturation` via luminance `mix`, then a
      **static** scalar dither, then `clamp`.
- [ ] `speed` (Motion, `min: 0`), `brightness`, `saturation` (min 0, max ≥ 2) all present.
- [ ] No `uDate` / `uAudio` unless it is genuinely a clock / reactive shader.

### Step 7 — verify in the repo (the real gate)

```sh
npm run typecheck                              # regenerates the registry, then tsc
npm test                                       # manifest contracts, ranges, uniforms
SCRNSVR_SHADER_FILTER=<id> npm run check-shaders   # Chromium/WebGL 1 + 2, all hard rules
npm start -- --preview --shader <id>
```

`check-shaders` is the authority for everything in §4. Run it on the single shader first
(the filter is much faster than the full sweep), then once unfiltered before you finish.

## 4. What shadereye cannot check — the list to hand to `check-shaders`

None of these are visible in a shadereye render, and all of them can fail the build:

| Rule | Why shadereye can't see it |
|---|---|
| `speed: 0` renders a byte-identical frame at `uTime = 0` and `100` | no `speed` uniform; cannot hold time and compare |
| `saturation: 0` is exactly `r == g == b` on every pixel | you would have to test it pixel-by-pixel; use `probe_pixels` for a spot check only |
| Every declared uniform is *used* and *visibly changes output* | unused uniforms are compiler-dropped; needs the real GL program |
| Every numeric `min`/`max` endpoint is safe at `uTime = 86400` | no endpoint sweep; division/NaN guards are invisible in one frame |
| Short-edge framing in portrait + ultrawide | *partly* — you can preview it (§3), but the harness is the assertion |
| Compiles in **both** WebGL 1 and WebGL 2 | shadereye uses one backend (Vulkan) |
| No non-constant loop bounds / dynamic indexing | ES 1.00 restriction; shadereye's dialect is looser |
| Readback cost at 1920×1080 | needs the harness timing report |
| Manifest rules (ids, step-aligned defaults, `random` windows, `visibleWhen` types, `colorRole`) | not shader-eyeball material at all |
| Colour schemes / Noctalia import behaviour | requires the settings UI |

## 5. Gotchas and tips

- **Timeouts are the scrnsvr dialect, not a bad idea.** If a render hangs, check the entry
  point and `gl_FragColor` before you rewrite the maths.
- **Freeze `time` for comparisons.** `render_shader(source, w, h, time)` gives a
  deterministic frame, so two edits are actually comparable. Comparing two "live" renders
  tells you nothing.
- **A single still hides strobe.** Anything with fine high-frequency detail (moiré,
  halftone, fine grids) must be checked with `render_animation` or with two or three
  different `time` values. Near-Nyquist detail can also shimmer differently at other
  resolutions — re-render at 1920×1080 width if the pattern is fine.
- **Prototype perf roughly by eye, confirm with the harness.** A heavy per-pixel loop
  (hundreds of iterations) renders fine locally and can still be the slowest shader in the
  collection; `check-shaders` reports readback timing, so treat that number as the answer.
- **Loop a bounded iteration count with `break`, never a dynamic bound.** ES 1.00 forbids
  non-constant loop bounds, so `for (int i = 0; i < 2000; i++) { if (float(i) >= samples) break; }`.
  This compiles in shadereye too, so you can prototype the knob before porting.
- **Don't trust `validate_shader`.** A clean result means nothing; a failure means nothing.
  It rejected a perfectly valid Shadertoy source with `UnknownVariable("iResolution")`.
- **In-repo shaders already have hash/noise helpers.** Before writing your own
  `fract(sin(dot(...)))` hash, check a neighbouring shader for the collection's helper and
  reuse its precision characteristics — the naive hash can band at high frequency on some
  drivers.
- **Keep the prototype in the plan or the PR description.** shadereye state is not
  persisted anywhere; the Shadertoy-dialect source plus the rendered stills is the only
  record of how the look was reached.

## 6. Worked example: prototype → port

Prototype (Shadertoy dialect, consts, one grid pair):

```glsl
const float gridFrequency = 30.0;
const float lineWidth = 0.09;

float gridLines(vec2 p, float ang, float freq, float w) {
  float c = cos(ang), s = sin(ang);
  vec2 q = mat2(c, -s, s, c) * p;
  vec2 f = abs(fract(q * freq) - 0.5);
  return max(1.0 - smoothstep(0.0, w, f.x), 1.0 - smoothstep(0.0, w, f.y));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 p = (2.0 * fragCoord - iResolution.xy) / min(iResolution.x, iResolution.y);
  float t = iTime;
  float spread = 0.045 + 0.02 * sin(t * 0.1);
  float a = t * 0.03, b = spread + t * 0.02, c = -spread * 0.8 - t * 0.02;
  float sum = gridLines(p, a, gridFrequency, lineWidth)
            + gridLines(p, b, gridFrequency, lineWidth)
            + gridLines(p + 0.35, c, gridFrequency, lineWidth);
  vec3 bg = vec3(0.03, 0.04, 0.08), ink = vec3(0.30, 0.55, 0.85), hi = vec3(1.0, 0.86, 0.58);
  vec3 col = mix(bg, ink, clamp(sum, 0.0, 1.0));
  col = mix(col, hi, smoothstep(0.75, 1.7, sum));
  col *= 0.85 + 0.4 * (sum / 3.0);
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
```

Port (scrnsvr contract — header + tail shown, body unchanged):

```glsl
precision highp float;

uniform float speed;            // manifest: Motion, min 0
uniform float gridFrequency;    // manifest: Shape
uniform float lineWidth;        // manifest: Shape
uniform float angleSpread;      // manifest: Shape
uniform float spreadPeriod;     // manifest: Motion
uniform float phaseOffset;      // manifest: Shape
uniform vec3  ink;              // manifest: Color, colorRole primary
uniform vec3  highlight;        // manifest: Color, colorRole tertiary
uniform vec3  background;       // manifest: Color, colorRole surface, random false
uniform float brightness;
uniform float saturation;
uniform vec2  uResolution;
uniform float uTime;

float gridLines(vec2 p, float ang, float freq, float w) { /* identical */ }

void main() {
  vec2 p = (2.0 * gl_FragCoord.xy - uResolution.xy) / min(uResolution.x, uResolution.y);
  float t = uTime * speed;                       // every term below uses t, never uTime
  float spread = angleSpread + 0.02 * sin(t * spreadPeriod * 0.1);
  float a = t * 0.03 + phaseOffset;
  float b = spread + t * 0.02;
  float c = -spread * 0.8 - t * 0.02;
  float sum = gridLines(p, a, gridFrequency, lineWidth)
            + gridLines(p, b, gridFrequency, lineWidth)
            + gridLines(p + 0.35, c, gridFrequency, lineWidth);
  vec3 col = mix(background, ink, clamp(sum, 0.0, 1.0));
  col = mix(col, highlight, smoothstep(0.75, 1.7, sum));
  col *= 0.85 + 0.4 * (sum / 3.0);

  // standard tail ------------------------------------------------
  col *= brightness;
  col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, saturation);
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  gl_FragColor = vec4(clamp(col + (dither - 0.5) / 255.0, 0.0, 1.0), 1.0);
}
```

Note what changed beyond the header: constants that were purely stylistic became uniforms
(so each one needs a manifest entry), `phaseOffset` was introduced to give a knob something
to do, and `spreadPeriod` was pulled out of the hardcoded `0.1` so the beat rate is
controllable. Then: register in `tests/shader-manifests.test.ts`, add a row to
[docs/shader-parameters.md](shader-parameters.md), and run the Step 7 checks above.

## See also

- [authoring-shaders.md](authoring-shaders.md) — the full scrnsvr contract and hard rules.
- [authoring-shaders-brief.md](authoring-shaders-brief.md) — the same contract as a short brief.
- [authoring-shaders-standalone.md](authoring-shaders-standalone.md) — self-contained briefing for an author with no repo access.
- `.pi/plans/2026-09-27-new-abstract-shader-batch-2.md` — a worked batch that uses this workflow, including which shadereye paths to avoid.
