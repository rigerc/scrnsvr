# scrnsvr website

The Astro homepage, shader gallery, and Starlight user guides build together as a static site. The planned public URL is `https://rigerc.github.io/scrnsvr/`.

## Develop and check

Use Node from `.nvmrc` and pnpm 10.33.0. Run these commands from `website/`.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm lint
pnpm check
pnpm test:run
SITE_URL=https://rigerc.github.io BASE_PATH=/scrnsvr pnpm build
pnpm check:site --strict
BASE_PATH=/scrnsvr pnpm preview --port 4321 --strictPort
```

The production preview is available under `/scrnsvr/`. Use `src/config/project.config.ts` for the homepage and `src/content/docs/docs/` for the user guides. The gallery reads the app's shader manifests directly from `../data/shaders/`.

## Refresh product media

The app shots and motion previews are from the verified scrnsvr v1.0.0 AppImage; the stills of the shaders added in 1.1.0 are from the 1.1.0 build. Capture again on a Wayland compositor with layer-shell support. Use a clean config and state directory so personal settings and the desktop are outside the capture.

- Run `scrnsvr --thumbnail --output /tmp/scrnsvr-thumbnails`. Convert the 640×360 PNGs to WebP at quality 85, and keep the shader IDs as filenames under `public/media/shaders/`.
- For each featured shader in `src/lib/shader-gallery.ts`, open `scrnsvr --preview --shader <id>` with the clock off. Record 5–8 seconds of the preview with a Wayland recorder. Encode the clip as a silent 640×360 H.264 MP4 with `-pix_fmt yuv420p -movflags +faststart`, and save it beside its still.
- Open `scrnsvr --settings` for the Visuals and Effects stills and use Fullscreen preview for the clock still. Capture the native screens at 1600×900 and encode them as WebP. Record the walkthrough from Visuals through the speed adjustment and Bloom to fullscreen preview. Save the three stills and walkthrough in `public/media/app/`.

To capture the **website** for review, install Chromium with `pnpm exec playwright install chromium`, start the production preview, and set `PLAYWRIGHT_BASE_URL=http://127.0.0.1:4321/scrnsvr` for `pnpm media:capture` and `pnpm media:video`. The latter also requires FFmpeg. GitHub Actions uploads these outputs as artifacts.

## Deploy

Set **Settings → Pages → Source** to **GitHub Actions**, then run **Deploy website to GitHub Pages** from the default branch. Later published releases deploy the version in their tag. If the `github-pages` environment restricts deployment refs, allow the default branch and the project's `v*` release tags. Manually dispatch deployment if releasing with the repository's `GITHUB_TOKEN`. To roll back a site update, revert it and dispatch a new run from the default branch.

## Attribution

Based on [project-website-bootstrap](https://github.com/rigerc/project-website-bootstrap/tree/7d008f40c41660b34b6dc17854eb032b7f4760d4), which adapts Astro Rocket by Hans Martens. The upstream MIT notice is in [LICENSE](LICENSE).
