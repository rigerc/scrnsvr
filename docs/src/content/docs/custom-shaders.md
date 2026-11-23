---
title: Add a custom shader
description: Write, import, and debug single-pass GLSL visuals.
---

In **Visuals**, select **Add shader** to open the editor. Give the shader a title, then edit the starter code or use **Import…** to open a UTF-8 `.glsl` or `.frag` file up to 100 KB. The editor saves valid changes automatically and keeps the last working shader in the preview while you fix an error. Check the line marked in the editor for the compile error.

## Write the fragment shader

Use single-pass GLSL ES 1.00, with `mainImage(out vec4 color, in vec2 fragCoord)` or `main()` as the entry point. In `main()`, write to `gl_FragColor`. Remove `#version` directives and texture or multipass inputs before importing.

```glsl
void mainImage(out vec4 color, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec3 rgb = 0.5 + 0.5 * cos(iTime + uv.xyx * 6.0 + vec3(0.0, 2.0, 4.0));
  color = vec4(rgb, 1.0);
}
```

| Name | Type | Value |
| --- | --- | --- |
| `uTime`, `iTime` | `float` | Elapsed time in seconds |
| `uResolution` | `vec2` | Framebuffer width and height in pixels |
| `iResolution` | `vec3` | Framebuffer width, height, and `1.0` |
| `iDate` | `vec4` | Year, month, day, and seconds since midnight at start plus elapsed time |
| `iMouse` | `vec4` | All zeros |
| `uAudio` | `vec4` | All zeros in 1.x |

These names are supplied by scrnsvr. Use them directly and remove any extra uniform declarations from a ported shader.

Select **Fullscreen preview** to try the shader as a screensaver. You can favorite it, add it to shuffle, and use the global effects stack with it. Deleting a custom shader also removes it from favorites and shuffle.
