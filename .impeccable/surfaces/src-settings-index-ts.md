---
version: 1
slug: "src-settings-index-ts"
primary_target: "src/settings/index.ts"
related_targets: ["src/settings/settings.css"]
---

# Settings / Visual Mixer

Mode: Operate. Audience: Linux desktop users choosing a shader to preview, then tuning it. Preserve all settings and locally saved data.

## Direction contract

**THESIS:** Choosing a shader is cueing a live visual. Bring the shader bank into the first viewport beside the large output; avoid burying discovery beneath configuration.

**OWN-WORLD:** Matte charcoal instrument surfaces, warm ivory typography, coral for selection and action, hairline separators, flush shader glass. Small silkscreen labels organize controls; actual shader imagery owns the saturated color.

**STORY:** Browse distinct live thumbnails, choose one, see it immediately on the large output, then tune it in a persistent inspector. Clock, rotation, audio, presets, and global settings stay reachable without distracting from selection.

**FIRST VIEWPORT:** At 1280×800, a 54px top navigation bar sits above a 270px left shader bank, a flexible 600px center live output, and a 275px right inspector. Six or more thumbnails are visible in two columns. The selected image has a coral frame. The live output matches it; title and status sit beneath. The inspector begins with the real shader's controls. Selecting a tile is the signature interaction: selection outline and preview update together, without a page transition.

**FORM:** Visual Mixer, grounded direction 1, concept seed `ceeb1022`, chosen as Impeccable's pick by the user. The approved visual target is `.impeccable/mocks/decision/model-pick.png`.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
