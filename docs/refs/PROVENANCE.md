# Reference material provenance

## Atelier generative examples

- Source: [jangles-byte/atelier](https://github.com/jangles-byte/atelier), revision `058576acd171c45174cc099b3d55b0e8fb3dd148` (2026-07-25)
- Imported path: `examples/generative/`
- License: MIT, Copyright (c) 2026 Atelier contributors. The upstream `LICENSE` applies to every file in this directory.

| File | Bytes | Note |
|---|---|---|
| `README.md` | 3775 | Upstream gallery notes: the intent behind each piece and why colour is earned |
| `_gen.css` | 632 | Shared styling for the sketches |
| `_gen.js` | 2717 | Shared toolkit: seeded mulberry32 PRNG, seeded Perlin, `fbm`, OKLCH→sRGB with a 256-entry ramp LUT |
| `_idle.html` | 405 | Placeholder page — the sketches are GPU-heavy and are parked here on purpose |
| `attractor.html` | 2779 | Clifford attractor, 420k iterated points per frame, log-scaled visit density |
| `boids.html` | 3475 | Flocking; colour earned by local density; speed clamped to a band |
| `ember.html` | 4371 | Two-octave noise field sampled as an angle; colour earned by velocity |
| `orbits.html` | 3254 | N-body with trails; force-law softening; colour earned by speed |
| `physarum.html` | 8006 | 1,048,576 agents as a 1024² float texture, four GPU passes per frame |
| `warp.html` | 2391 | Domain-warped noise at a third scale, upsampled |

All ten files are byte-identical to the pinned revision (`git hash-object` matches the upstream blob SHAs).

### Notes for this project

- **Offline-safe.** The sketches are self-contained and reference only the local `_gen.css` and `_gen.js`; there are no CDN or network imports. The only remote references are the `.gif` previews in `README.md`, which will not render offline.
- **Not part of the build.** Nothing here is imported by `scripts/build.mjs` or shipped in `dist/`. These are reference implementations to read and adapt, not dependencies.
- **`_gen.js` is the immediately useful part.** scrnsvr's shaders are single-pass fragment shaders with no CPU-side noise or colour code, so the PRNG/Perlin/OKLCH helpers do not port directly — but `ramp()` and the OKLCH conversion are a usable reference for the palette work in `src/shared/palettes.ts`, and `makeNoise`/`fbm` document the seeded-permutation and `lacunarity 1.97` conventions these sketches use.
- **Style difference.** These are Canvas 2D / CPU sketches with a small GLSL portion, whereas scrnsvr's 44 effects are pure GLSL. Treat them as algorithmic references (field sampling, density-to-tone mapping, envelope and softening rules) rather than as code to lift.

### Re-syncing

```sh
SHA=058576acd171c45174cc099b3d55b0e8fb3dd148
for f in README.md _gen.css _gen.js _idle.html attractor.html boids.html ember.html orbits.html physarum.html warp.html; do
  curl -sSfL "https://raw.githubusercontent.com/jangles-byte/atelier/$SHA/examples/generative/$f" -o "docs/refs/$f"
done
```
