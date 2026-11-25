---
name: scrnsvr
description: A calm night desk for choosing, previewing and tuning screensaver shaders, in the Focus identity.
colors:
  canvas: "#0b0f19"
  night: "#101522"
  preview-surface: "#080b13"
  raised: "#161d2d"
  control: "#1a2234"
  control-hover: "#232d44"
  line: "#1f283a"
  line-strong: "#34405a"
  ink: "#edf1f7"
  muted: "#a8b2c4"
  quiet: "#8590a6"
  signal: "#23d5ab"
  signal-hover: "#5be5c4"
  brand-blue: "#3268ff"
  blue-ink: "#8aa6ff"
  alert: "#ff8f70"
  saved: "#8fe3c8"
typography:
  title:
    fontFamily: "Inter Tight, Inter, Liberation Sans, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 500
    lineHeight: 1.2
  panel-heading:
    fontFamily: "Inter Tight, Inter, Liberation Sans, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Inter Tight, Inter, Liberation Sans, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  help:
    fontFamily: "Inter Tight, Inter, Liberation Sans, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Inter Tight, Inter, Liberation Sans, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.45
rounded:
  control: "6px"
  tile: "8px"
  card: "10px"
  pill: "9999px"
spacing:
  compact: "8px"
  gallery: "10px"
  panel: "16px"
  inspector: "20px"
  section: "24px"
components:
  button-default:
    backgroundColor: "{colors.control}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
  button-primary:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.night}"
    rounded: "{rounded.control}"
  shuffle-toggle-on:
    backgroundColor: "{colors.brand-blue}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
  input:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
  shader-tile:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.muted}"
    rounded: "{rounded.tile}"
  inset-card:
    backgroundColor: "{colors.raised}"
    rounded: "{rounded.card}"
---

# Design System: scrnsvr

## Overview

**Creative North Star: "Focus at night"**

The settings window is a quiet desk at night with one lit screen. The shell takes the Focus brand's Night (`#101522`) and steps darker around it, so a shader's colour is always the brightest thing on screen. The logo's two ideas carry through the interface. The teal end of the wave marks selection, focus and anything you can adjust. The focal dot marks what is current: the open section, the chosen visual, an edited parameter and the save state.

**Key characteristics:**

- A 56px brand bar: the Focus app icon and wordmark, the four sections (Visuals, Shuffle, Clock, Settings), and the save state.
- Three desktop columns: the library, the open section's content, and a collapsible live preview on the right.
- Library tiles are landscape (16:9), the shape of the screen they will fill.
- Deep navy surfaces, hairline rules and inset cards instead of shadows.
- Teal means *selected or adjustable*, blue means *in shuffle or in progress*, warm coral means *problem*.

## Brand

The Focus logo kit lives in `assets/brand/`; its guidelines are in `assets/brand/README.md`. `assets/icon.svg` and `website/public/scrnsvr.svg` are the kit's app icon. The settings window embeds four derived files from `crates/scrnsvr-settings/assets/brand/`:

- `appicon-small.svg`: the kit's small-size cut. It sits at 28px in the brand bar, where its Night tile blends into the chrome and leaves the gradient wave and white dot.
- `wordmark.svg`: the wordmark paths from the reversed horizontal lockup, drawn in Ink next to the icon. It is hidden below 820px; the icon stays.
- `appicon.svg`: the master icon, 56px in Settings › About next to the wordmark, version and settings path.
- `symbol.svg`: the white symbol, drawn at 14–20% opacity in waiting and empty states (thumbnails still rendering, no preview, no matches).

The gradient appears only inside the logo artwork. The interface uses its two end colours separately and never as gradient text or gradient fills.

## Colors

- **Canvas** `#0b0f19`: brand bar, the content panel, and inset wells (clock example, hypridle snippet, About).
- **Night** `#101522`: library and inspector panels.
- **Preview surface** `#080b13`: the preview panel around the live screen, the darkest field.
- **Raised** `#161d2d`, **Control** `#1a2234`, **Control hover** `#232d44`: inset cards, inputs, buttons and their hover.
- **Line** `#1f283a`, **Strong line** `#34405a`: rules, input borders, the miniature screen.
- **Ink** `#edf1f7`, **Muted** `#a8b2c4`, **Quiet** `#8590a6`: text hierarchy. Quiet still clears 4.5:1 on Night.
- **Signal teal** `#23d5ab` (hover `#5be5c4`): the selected tile frame and dot, the active section's icon, slider bars, focus rings, primary buttons (with Night text), edited-parameter dots and the "Saved locally" dot.
- **Brand blue** `#3268ff`: shuffle membership: the filled "In shuffle" toggles and chips, the library tick boxes and the tile badge, all with white marks. **Blue ink** `#8aa6ff` is the dot for work in progress (saving, fullscreen opening).
- **Alert** `#ff8f70`: errors, failed saves, invalid patterns and destructive confirmation. It is never used for selection.

## Typography

One family: Inter Tight, then Inter, then Liberation Sans. The stage title is 30px medium; panel headings are 15px semibold; body text is 14px; help and descriptions are 12px Quiet; group labels are 11px bold uppercase Quiet, followed by a hairline that runs to the panel edge.

## Layout

The brand bar is 56px tall. On wide windows every section shows an icon and a label. At 1120px and below, only the open section keeps its label and the others become icon buttons with tooltips. At 620px and below, the wordmark and the save text are hidden and only the save dot remains, unless saving has failed.

Wider than 760px, the window has three columns:

1. **Library** (left): 22% of the width, 232–440px. Two tile columns, or three once it is at least 400px wide.
2. **Content** (middle, flexible): the open section's heading and controls, at most 760px wide, scrolling on its own.
3. **Preview** (right): 34% of the width, 300–680px. It folds to a 52px rail that keeps show, play/pause and fullscreen in reach. The folded state is kept in `ui.toml` with favorites. While it is folded, the renderer stops drawing.

At 760px and below, the preview (or its folded header), the library and the content stack in one scrolling column.

The preview's screen keeps the aspect ratio of the display that contains the window and never takes more than half the window's height. The panel paints only its header, the 16px gutters beside the screen, and the deck below it. The screen's own rectangle stays unpainted so the preview subsurface beneath the window shows through.

## Components

- **Library:** "Library" heading with a count ("54 visuals", or "3 of 54" while filtered), a ghost "New shader" action, a search field with a search glyph, and one wrapping row of pill filters: All, Favorites, then each collection (Light, Night & Water, Materials, Color Fields, Linework, Shapes, Paper & Cutouts, and Your shaders when there are custom shaders). The active pill is teal-tinted. Visuals are grouped by collection in that order, each appearing once, alphabetical within its group; there is no featured row. A group heading (chevron, label, count, hairline) folds the collection to its heading, remembered in `ui.toml`; searching or picking a collection opens every group it shows. On opening, the library scrolls to the chosen visual. Collections come from each manifest's `collection` field and the order from `data/collections.json`, shared with the website gallery. Tiles are 16:9 with an 8px radius. The selected tile gets a 2px teal frame, and its name gains the focal dot and turns semibold Ink. The favorite star sits on a dark chip at top right and turns teal when filled. Shuffle members wear a small blue shuffle badge at top left. On Shuffle that badge becomes a tick box on every tile (blue check, or a plus on a dark chip), and a hint under the filters says what ticking does.
- **Content panel:** a 20px semibold heading led by the section's teal glyph, then one line of context. Visuals is headed by the visual's own name, then its look bar and a Parameters | Effects segmented switch. Problems that concern the whole window (failed save, close without saving, configuration warnings) sit above the section's controls. Primary controls sit in inset cards: the look bar, Randomize, the look's effects switch, shuffle timing, Show clock with a live example, Noctalia import, the idle setup proposal.
- **Preview panel:** a "Live preview" header with a dot (teal while playing, Quiet while paused) and the fold button; the screen; then a deck with a fact line (category · open look · Favorite), a 22px title, the description, and Pause/Resume, Fullscreen, the visual's shuffle toggle and the named Undo. Fullscreen progress, renderer errors and skipped effect layers appear as dot notices beneath.
- **Parameter row:** the name, plus a teal dot once it is edited; glyph-only lock and reset on the right; then the description, then the slider and number field, swatch, select or switch. The custom-shader editor sits above the parameters when a custom visual is selected.
- **Look bar:** at the top of the Visuals editor, on Raised. Chips for Current edits and each saved look; the open one is teal-tinted with the focal dot, and members of the shuffle set carry a small blue shuffle glyph. Selecting a chip edits that look in place: the preview shows it, and parameters and effects save to it, with undo per look. "Save as look" opens an inline name field and then the new look. Below the chips, a line names what is being edited, with rename and delete for a saved look and the blue In shuffle toggle for that exact look. Delete and replace confirm inline.
- **Effects pane:** the open look's stack. A card switches the look's effects on or off, then Add a layer, then the stack. Every look and each visual's current edits keep their own stack; saving a look copies it.
- **Effect layer:** a numbered badge (teal while active), a disclosure summary and a switch, then move up/down and reset/remove as glyph buttons under a hairline. An expanded layer lifts to Raised with a Strong line border.
- **Shuffle set:** a timing card (shuffle on start, also change while it runs, interval) above a "Shuffle set" heading with Add favorites and Clear. Each visual in the set is one card: its thumbnail and title (which open it in Visuals), a toggle chip for Current edits and one for each saved look, and a remove button that takes the whole visual out. Entries for deleted looks show as Alert chips that remove themselves. The saver picks entries at random, so the set has no order to edit. Adding to an empty set turns shuffle on; emptying it turns shuffle off.
- **Shuffle toggles:** library tick, preview toggle and card remove all act on the whole visual. A visual not in the set joins with its current edits; one in the set leaves with all of its entries. Look-level choices are the chips on its Shuffle card and the In shuffle toggle in the look bar.
- **Clock placement:** a miniature 16:9 screen with nine targets. The chosen one shows the teal dot and a short bar standing in for the time.
- **About:** the master app icon, the wordmark, the version and the settings file path.

## Elevation and shapes

The interface is flat. Depth comes from the darker preview panel, inset cards one step lighter than their panel, and 1px rules. Controls use 6px corners, tiles 8px, cards 10px; the save status is a pill.

## Do's and Don'ts

### Do

- Let the shader be the brightest, most saturated thing in the window.
- Use teal for exactly one meaning: this is chosen, focused or adjustable.
- Mark the current item with the focal dot rather than another colour.
- Keep every action reachable by keyboard and give every glyph button a spoken label and tooltip.

### Don't

- Recolour the logo gradient, put it on text, or use it as a panel fill.
- Use the full-colour standalone symbol on Night: its dark dot disappears. Use the app icon or the white symbol.
- Use Alert coral for anything that is not a problem.
- Add drop shadows or glows to panels.

## Discovery and editing behaviours (unchanged)

Favorites are a local browsing preference, separate from shader configuration and shuffle membership. Empty results offer Clear filters, and unavailable storage is explained as session-only favorites. The live preview follows the aspect ratio of the display that contains the window, with a 16:9 fallback. Pause holds shader time in the preview and gallery. Reduced-motion preferences start paused, and choosing playback yourself overrides that. Reset, randomize and applying a look each offer a named, single-step undo. Failed autosaves offer Retry save without discarding edits.
