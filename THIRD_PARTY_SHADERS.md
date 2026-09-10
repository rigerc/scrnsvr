# Third-party shaders

scrnsvr includes browser-compatible ports of shaders from the following projects. The original source comments and author notices remain in each generated `shader.glsl` file.

## AVS

- Source: [PsyChip/AVS](https://github.com/PsyChip/AVS), revision `81d91f5533793f8c4daa983a7880356cf7c29a9d`
- Imported: `7seg`, `alienwater`, `cloud`, `field`, `fractal`, `galaxy`, `glowclock`, `greenclock`, `matrix`, `ocean`, `ripple`, `sea`, `seascape`, `sinus`, `stardust`, `terrain`, `tunnelwisp`, and `waves`
- The upstream repository does not contain a repository-level license. Individual shader notices vary; downstream distributors must review those notices and obtain any permissions their use requires.
- Not imported: `exit-05-perlin` and `exit-12-crosswarp` are transition passes that depend on desktop and previous-frame textures. `warp.glsl` is excluded because its copyright notice explicitly prohibits redistribution and project use.

## ShaderSaver

- Source: [fearlessfrog/ShaderSaver](https://github.com/fearlessfrog/ShaderSaver), revision `11aa9afed7974936ea7185fb201e5e23f0aa74da`
- Imported: Singularity, Sunset, Starship, Origami, Shield, Ghosts, Waveform, Water Ripples, Simplex, and Rainbow Road
- ShaderSaver's README identifies the project as MIT-licensed and credits the individual effects, primarily to Xor/@XorDev. The upstream repository does not include a separate license file; original per-shader notices and source links are preserved in each port.

## Porting notes

The imported sources target desktop OpenGL or Shadertoy. `scripts/import-upstream-shaders.mjs` reproduces the ports from local clones of the pinned upstream revisions. It adds scrnsvr's standard speed, contrast, brightness, and saturation controls; maps Shadertoy time and resolution uniforms; replaces unavailable texture input in Starship with deterministic procedural noise; and rewrites desktop-only GLSL constructs for WebGL 1 and WebGL 2.

## LYGIA simplex noise

Opal Film and Ink Bloom embed the `vec2` overload of `generative/snoise.glsl`
and the required `math/mod289.glsl` and `math/permute.glsl` overloads from
[LYGIA](https://github.com/patriciogonzalezvivo/lygia/tree/24e4af66c2c98d42ce5ee6da6d5e2bf6423f5a0c).
The functions are inlined so the shaders remain standalone and require no runtime downloads or include resolver.

Copyright 2021-2023 by Stefan Gustavson and Ian McEwan.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
