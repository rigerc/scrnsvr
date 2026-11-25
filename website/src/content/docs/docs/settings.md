---
title: Customize the screensaver
description: Pick a visual, edit its looks and their effects, and set up shuffle and the clock.
sidebar:
  order: 3
---

Run `scrnsvr` to open Settings. The library is on the left, the open section in the middle, and the live preview on the right. Fold the preview to a slim rail with the button in its header. Changes save automatically. If saving fails, **Retry** keeps your edits and tries again. Settings tabs also work with the Left, Right, Home, and End keys.

## Choose and tune a visual

1. Search the library or narrow it to one collection: Light, Night & Water, Materials, Color Fields, Linework, Shapes, or Paper & Cutouts. Fold a collection by its heading. Favorite a shader to find it quickly later.
2. Adjust **Motion**, **Shape**, and **Color**. Open **Advanced** for finer adjustments. Type into a value field and press Enter to set an exact number. Use **Reset** beside a control or **Reset parameters** to restore defaults.
3. Lock controls you want to keep before using **Randomize**. Use **Undo** to restore the previous values. For a still image set **Speed** to zero. For grayscale set **Saturation** to zero.
4. Select **Fullscreen preview** to see the selected visual in the actual saver. The inline preview starts paused when the desktop requests reduced motion. Resume animation to see motion there.

You can also [add a custom shader](../custom-shaders/).

## Change the colors

Use **Settings → Color scheme** to set a palette across built-in visuals that expose color controls. To give one visual a different palette, set its scheme in the **Visuals** inspector. Choose **Built-in colors** there to opt out of the global scheme. Changing a visual's scheme clears its manual color edits.

With Noctalia running, use **Import Noctalia colors** to bring its current palette into the selected visual. This maps Noctalia's primary, secondary, tertiary, surface, and on-surface colors to shader controls.

## Looks

The bar at the top of **Visuals** lists the visual's **Current edits** and its saved looks. Select one to edit it in place: the preview shows it, and the parameters and effects you change save to it. **Save as look** keeps what you are editing as a new look and opens it. The pencil and bin rename or delete the open look, and the shuffle button beside them adds that look to the shuffle set.

## Layer effects

Effects belong to looks: each look, and each visual's current edits, has its own stack. Open the **Effects** pane under the look bar, pick an effect, and select **Add**. You can stack up to eight layers and use an effect more than once. Layers run from top to bottom, so moving **Pixelate** above **Dream Blur** blurs the pixel edges. Use the reorder buttons or Alt+Up and Alt+Down.

Use **Intensity** to blend a layer with its input, the layer switch to bypass it, or the look's effects switch to bypass the whole stack while keeping your adjustments. Saving a look copies its stack; other visuals and looks keep their own. The clock is drawn above the effects. **Pause animation** freezes animated effects as well as the visual.

## Shuffle

Open **Shuffle** and tick visuals in the library to add them to the shuffle set, or use **Add to shuffle** beside the preview. Each visual in the set shows a chip for its current edits and each saved look; tick the ones the screensaver may pick. **Add favorites** adds every favorite at once. Adding to an empty set turns on **Shuffle when the screensaver starts**. To cycle during a session, enable **Also change while it runs** and set the interval in minutes. The windowed command-line preview always shows one visual.

## Set up the clock and displays

In **Clock**, enable or hide the overlay, pick one of nine positions, and adjust the font, weight, size, color, opacity, margin, and shadow. Choose 12-hour or 24-hour time and whether to show seconds and the date. To format the time yourself, enter a strftime pattern such as `%H:%M` or `%I:%M %p`. The example updates as you type. The date is controlled separately by **Show date**.

In **Settings**, set the frame rate, fade duration, and monitor coverage. **Primary** selects the output at logical position `(0, 0)` or the first available output. Choose **All** to cover every monitor.
