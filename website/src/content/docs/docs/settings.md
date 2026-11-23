---
title: Customize the screensaver
description: Pick a visual, tune its controls, layer effects, and set up looks, shuffle, and the clock.
sidebar:
  order: 3
---

Run `scrnsvr` to open Settings. Changes save automatically. If saving fails, **Retry** keeps your edits and tries again. Settings tabs also work with the Left, Right, Home, and End keys.

## Choose and tune a visual

1. In **Visuals**, search the shader bank or browse by category. Favorite a shader to find it quickly later.
2. Adjust **Motion**, **Shape**, and **Color**. Open **Advanced** for finer adjustments. Type into a value field and press Enter to set an exact number. Use **Reset** beside a control or **Reset shader** to restore defaults.
3. Lock controls you want to keep before using **Randomize**. Use **Undo** to restore the previous values. For a still image set **Speed** to zero. For grayscale set **Saturation** to zero.
4. Select **Fullscreen preview** to see the selected visual in the actual saver. The inline preview starts paused when the desktop requests reduced motion. Resume animation to see motion there.

You can also [add a custom shader](../custom-shaders/).

## Change the colors

Use **Settings → Color scheme** to set a palette across built-in visuals that expose color controls. To give one visual a different palette, set its scheme in the **Visuals** inspector. Choose **Built-in colors** there to opt out of the global scheme. Changing a visual's scheme clears its manual color edits.

With Noctalia running, use **Import Noctalia colors** to bring its current palette into the selected visual. This maps Noctalia's primary, secondary, tertiary, surface, and on-surface colors to shader controls.

## Layer effects

Open **Effects**, pick an effect, and select **Add effect**. You can stack up to eight layers and use an effect more than once. Layers run from top to bottom, so moving **Pixelate** above **Dream Blur** blurs the pixel edges. Use the reorder buttons or Alt+Up and Alt+Down.

Use **Intensity** to blend a layer with its input, the layer switch to bypass it, or **Enable effects** to bypass the stack while keeping your adjustments. The stack applies across visuals and saved looks. The clock is drawn above it. **Pause animation** freezes animated effects as well as the visual.

## Save looks and shuffle

In **Looks & Shuffle**, name and save the current visual's control values as a **look**. Apply the look later to restore those values. Add visuals or saved looks to the shuffle list, then turn on **Shuffle when the screensaver starts**. To cycle during a session, enable **Also change while it runs** and set the interval in minutes. The windowed command-line preview always shows one visual.

## Set up the clock and displays

In **Clock**, enable or hide the overlay, pick one of nine positions, and adjust the font, weight, size, color, opacity, margin, and shadow. Choose 12-hour or 24-hour time and whether to show seconds and the date. To format the time yourself, enter a strftime pattern such as `%H:%M` or `%I:%M %p`. The example updates as you type. The date is controlled separately by **Show date**.

In **Settings**, set the frame rate, fade duration, and monitor coverage. **Primary** selects the output at logical position `(0, 0)` or the first available output. Choose **All** to cover every monitor.
