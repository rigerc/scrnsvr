---
version: 1
slug: "crates-scrnsvr-settings-src-view-rs"
primary_target: "crates/scrnsvr-settings/src/view.rs"
related_targets: ["crates/scrnsvr-settings/src/effects_tab.rs","crates/scrnsvr-settings/src/looks_tab.rs","crates/scrnsvr-settings/src/clock_tab.rs","crates/scrnsvr-settings/src/system_tab.rs"]
---

# Settings window (native GPUI)

Mode: Operate. Audience: Linux desktop users picking a shader, previewing it live, then tuning it. Everything stays saved locally; feature behaviour is unchanged by the redesign.

## Direction contract

**THESIS:** The settings window is the screensaver's night desk: one lit screen, everything else receding into the Focus brand's Night. It refuses the generic charcoal-and-accent tool shell; the logo's wave and focal dot become the state language.

**OWN-WORLD:** Night navy grounds stepping darker toward the preview, hairline rules, inset Raised cards, teal for chosen/adjustable, brand blue for shuffle membership, coral only for problems, the focal dot marking whatever is current.

**STORY:** Find a visual in landscape tiles, tune it in the middle, watch it on the right. Sections for effects, looks and shuffle, clock and system swap the middle panel only. Shuffle is a set: tick visuals in the library, refine looks as chips.

**FIRST VIEWPORT:** At 1440×900: 56px brand bar (app icon + wordmark, five sections, save pill); 317px library with two columns of 16:9 tiles; a flexible content panel headed by the visual's name with the Randomize card on top; a 490px preview panel on the right with the live screen, title and transport, foldable to a 52px rail. Selecting a tile reframes it in teal and the preview updates in place.

**FORM:** Brief-pinned world from the user's Focus logo kit (no concept roll: the kit fixes palette and identity); code-led, no comp.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
