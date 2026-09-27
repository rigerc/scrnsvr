# Third-party shaders

scrnsvr's built-in shaders are its own work, with one exception: two effects inline a small
third-party noise function so they stay standalone. The original notice is preserved in each
affected `shader.glsl`.

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
