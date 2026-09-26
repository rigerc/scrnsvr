---
name: scrnsvr
description: A visual mixer for choosing and previewing screensaver shaders.
colors:
  canvas: "#171819"
  surface: "#191a1b"
  preview-surface: "#1a1b1c"
  raised: "#222425"
  control: "#252728"
  line: "#343738"
  line-strong: "#505455"
  ink: "#ebe9e2"
  muted: "#b6b5ae"
  quiet: "#898c89"
  signal: "#ef7b4d"
  signal-hover: "#ff976d"
  saved: "#85c6a1"
typography:
  title:
    fontFamily: "Inter Tight, Liberation Sans, system-ui, sans-serif"
    fontSize: "36px"
    fontWeight: 400
    lineHeight: 1.12
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Inter Tight, Liberation Sans, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Inter Tight, Liberation Sans, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.45
    letterSpacing: "0.20em"
rounded:
  control: "5px"
  small: "4px"
  dialog: "8px"
spacing:
  compact: "8px"
  gallery: "12px"
  panel: "20px"
  section: "24px"
components:
  button-default:
    backgroundColor: "{colors.control}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 11px"
  input:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "7px 8px"
  shader-tile:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
---

# Design System: scrnsvr

## Overview

**Creative North Star: "The Visual Mixer"**

The settings screen is an editing desk for shader exploration. Shader images provide the color; the surrounding interface is matte charcoal, precise, and quiet. A single warm signal color identifies the active shader, selected tab, and focused control. The first action is choosing and previewing a shader; tuning and system controls stay adjacent without overwhelming the image.

**Key Characteristics:**

- Three fluid desktop columns: shader bank, live preview, and inspector.
- Portrait shader tiles and a large live WebGL preview with clock overlay.
- Matte neutral surfaces, fine rules, warm coral interaction signal.
- Compact Inter Tight typography, with spaced uppercase section labels.

## Colors

The shell uses close charcoal tones to keep the shader artwork prominent. Warm off-white carries primary text, with two muted grays for secondary text and hints.

### Primary

- **Signal Coral** (`#ef7b4d`): active tile border and label, active tab, slider accent, and keyboard focus. Use `#ff976d` for hover emphasis.

### Neutral

- **Canvas Charcoal** (`#171819`) and **Mixer Surface** (`#191a1b`): page and workspace.
- **Preview Surface** (`#1a1b1c`) and **Raised Control** (`#222425`): separate work areas and inputs.
- **Fine Rule** (`#343738`) and **Strong Rule** (`#505455`): column and input boundaries.
- **Warm Ink** (`#ebe9e2`), **Muted Ink** (`#b6b5ae`), and **Quiet Ink** (`#898c89`): information hierarchy.

**The Shader Color Rule.** Let shader canvases carry saturated color. Reserve coral for actions and state.

## Typography

**Interface font:** self-hosted Inter Tight, with Liberation Sans and system fallbacks. The narrow forms support dense controls while leaving room for shader titles.

- **Preview title:** 36px, weight 400, tight tracking; names the selected shader beneath the preview.
- **Body:** 14px with 1.45 line height; used for controls and general interface copy.
- **Section label:** 11px, weight 700, uppercase, 0.20em tracking; marks bank and inspector sections.
- **Secondary text:** 11–13px; describes shaders and settings without competing with the image.

## Layout

The 54px top bar holds product name, Shaders/Clock/Settings tabs, and save status. On desktop, the workspace uses `minmax(250px, 1fr) minmax(0, 2fr) minmax(272px, 1fr)`. The outer columns therefore grow with wide windows instead of stopping at fixed widths. At 1920px they are 480px each, with a 960px preview column. The preview itself can grow to 1100px.

The bank has two tile columns, changing to three at 1700px. The three work areas scroll independently on desktop. At 980px and below, the inspector moves below bank and preview; at 620px and below, the work areas stack. Mobile styling is a fallback, not the primary design target.

## Elevation & Depth

The interface is flat. One-pixel rules and small shifts in charcoal provide separation. The shader imagery creates depth inside the preview and tile canvases. The custom shader dialog uses a dark backdrop.

## Shapes

Controls and shader images use 4–5px corners; the custom editor uses 8px. The geometry is restrained and mostly rectangular. Focus uses a 2px coral outline with a 2px offset.

## Components

- **Visual tile:** portrait live canvas and one-line name. The active canvas gains a coral border and name.
- **Live preview:** large WebGL canvas with the actual clock overlay, followed by a ruled caption and shader description.
- **Inspector control:** group label, compact name/reset row, slider or field, and numeric value where useful. Advanced controls collapse below the primary set.
- **Looks & Shuffle:** the selected visual's saved looks sit beside a compact live preview, with the shuffle list and timing controls in the inspector. Named looks and current edits have separate, explicit add/remove actions.
- **Navigation tabs:** plain text in the top bar; the selected tab receives a coral underline.
- **Action button and input:** charcoal fills and fine borders, with coral hover and focus treatments.

## Do's and Don'ts

### Do:

- Keep shader selection and the live preview visible together on wide screens.
- Let sidebars expand with the viewport so tile and control space remains useful.
- Use coral consistently for selected, focused, and adjustable states.

### Don't:

- Add decorative shadows or bright panel colors to the shell.
- Hide the real shader or clock behind a static illustration.
- Hide saved looks and shuffle timing under unrelated settings.
