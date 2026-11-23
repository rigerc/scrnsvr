# Built-in catalog sources

Everything scrnsvr ships as shaders, effects and color schemes lives here as plain files. `crates/scrnsvr-core/build.rs` assembles them at compile time into one JSON document (`$OUT_DIR/catalog.json`) that `scrnsvr_core::catalog::Catalog::builtin()` embeds. No Node or other generator is involved; edit a file and rebuild.

```
data/
  shaders/<id>/manifest.json     id, title, category, description, "fragment": "shader.glsl", "animationTime", uniforms
  shaders/<id>/shader.glsl       Shadertoy-style mainImage(out vec4, in vec2) source
  effects/<id>/manifest.json     id, title, description, uniforms, "source": "effect.glsl", optional "passes", "history"
  effects/<id>/effect.glsl       the final (or only) pass
  effects/<id>/pass-N-*.glsl     earlier passes of a multipass effect (bloom), listed in "passes" in order
  effects/order.json             effect IDs in display order; must list every effect directory
  palettes.json                  30 color schemes: id, name, variant, background, foreground, cursor, ansi[16], roles
  color-families.json            five three-color families used by the settings app
```

- A directory name must equal the manifest `id`; the build fails with a message otherwise.
- Manifests name their GLSL files; the build replaces `fragment`/`source`/`passes` file names with the file text.
- Uniform definitions use `name`, `type` (`float`, `int`, `bool`, `color`, `select`), `default`, `label`, `description`, `group`, and where they apply `min`, `max`, `step`, `unit`, `options`, `colorRole`, `advanced`, `visibleWhen` and `random`. Field names are camelCase. See `crates/scrnsvr-core/src/catalog.rs` for the meaning and for how values are normalized.
- Third-party code inside a shader keeps its notice in the `.glsl` file and in [`THIRD_PARTY_SHADERS.md`](../THIRD_PARTY_SHADERS.md).

`crates/scrnsvr-core/tests/fixtures/catalog.json` is the catalog the last TypeScript release (v0.10.0) generated. `tests/catalog_sources.rs` requires the assembled catalog to equal it, so when you change a built-in on purpose, update that fixture in the same commit (print `scrnsvr_core::catalog::BUILTIN_CATALOG_JSON` from a scratch test, or copy `$OUT_DIR/catalog.json` from `target/debug/build/scrnsvr-core-*/out/`).

The palettes were curated from the Ghostty/iTerm2 color-scheme YAML files in [`../reference/`](../reference/). Nothing reads that directory at build or run time; to add a scheme, copy its sixteen ANSI colors, background and foreground into `palettes.json` and derive `roles` the way the existing entries do (`primary`, `secondary`, `tertiary`, `surface`, `onSurface`).
