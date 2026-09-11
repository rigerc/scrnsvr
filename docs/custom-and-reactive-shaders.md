# Custom and reactive shaders

## Your own shaders

Choose **Add shader** in Settings, name it, and paste GLSL or import a `.glsl`, `.frag`, or `.txt` file. Preview compiles and renders the source; **Save shader** also compiles it before saving. Errors stay in the editor without replacing your saved shader. Saved shaders appear under **Custom**. Select one and choose **Edit source** to update it without breaking rotation entries or presets.

Sources are stored locally in the existing config JSON, including across restarts. Up to 100 shaders, 100,000 source characters each. Back up the config to transfer them.

Supported: single-pass GLSL ES 1.00 with `mainImage(out vec4 color, in vec2 fragCoord)` or `main()` / `gl_FragColor`. The app supplies `uTime` (float seconds), `uResolution` (vec2 pixels), and Shadertoy aliases `iTime`, `iResolution` (vec3), `iDate` (vec4). `iMouse` is zero. No textures, `iChannel` inputs, extra uniforms, multipass buffers, or GLSL 300 version directives. Custom sources do not automatically gain built-in sliders. Only import shader code you trust: expensive GPU programs can stall rendering.

## Reactive category

The Reactive collection combines slow ambient animation with optional, subtle playback response:

- **Lightwell**: defocused ivory and amber light drifting across charcoal, with a cool slate accent.
- **Quiet Horizon**: lavender haze and pale peach light above layered navy silhouettes.
- **Velvet Cloud**: a softly shaded volume of smoky plum and copper folding through darkness.

Enable **React to playing audio** in Settings. Musical accents move the light pools, lift the horizon layers, and expand the cloud. The response follows an accent within a few tenths of a second, then fades smoothly, with a 160ms attack and 650ms release time constant. The meter shows incoming audio directly; the status reports capture failures. **Audio influence** adjusts the strength and saves in presets. With audio disabled or silent, all three retain their complete ambient animation. Speed controls that animation; audio can still move the effect at speed zero. Primary, secondary, and background colors are editable.

These replace Pulse Rings, Audio Ribbons, and Bass Bloom respectively. Their internal IDs and existing control ranges are preserved, so saved selections, rotation entries, and presets continue to work with the new visuals.

Capture uses Linux `parec` (the `pulseaudio-utils` package) with PulseAudio or PipeWire's `pipewire-pulse` service. It reads the **default output monitor**, never the microphone. It processes samples in memory and neither saves nor uploads audio. One capture process serves all app windows and stops when disabled or no subscribers remain. The saved opt-in applies to subsequent screensaver sessions. After changing output devices, toggle audio off and on to reconnect to the new default monitor.

Leave **Don't start while audio is playing** unchecked if you want the idle daemon to launch these effects during music playback. If capture fails, install the dependencies/check your audio service and toggle off/on to retry. Other operating systems currently show an unsupported status.

The monitor device selection uses PulseAudio's documented [`@DEFAULT_MONITOR@` source](https://github.com/pulseaudio/pulseaudio/blob/master/src/utils/pacat.c).
