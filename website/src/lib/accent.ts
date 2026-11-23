/**
 * Turns the one accent colour in `project.config.ts` into the CSS custom
 * properties each part of the site reads, so changing the colour changes all
 * of them together.
 *
 * Plain module with no Astro or alias imports: `astro.config.mjs` uses it for
 * the Starlight docs, and `BaseLayout.astro` uses it for the homepage.
 */

const mix = (color: string, pct: number, other: string) =>
  `color-mix(in oklab, ${color} ${pct}%, ${other})`;

/**
 * Overrides the Astro Rocket `--brand-*` scale (header, footer, focus rings)
 * and sets the homepage `--project-accent`.
 *
 * The selector outranks the palette files' `html[data-theme="…"]`, so the
 * accent wins whichever built-in palette is active.
 */
export function siteAccentCss(accent: string): string {
  const scale: [number, string][] = [
    [50, mix(accent, 8, 'white')],
    [100, mix(accent, 16, 'white')],
    [200, mix(accent, 35, 'white')],
    [300, mix(accent, 60, 'white')],
    [400, mix(accent, 82, 'white')],
    [500, accent],
    [600, mix(accent, 85, 'black')],
    [700, mix(accent, 70, 'black')],
    [800, mix(accent, 52, 'black')],
    [900, mix(accent, 35, 'black')],
  ];
  const vars = scale.map(([step, value]) => `--brand-${step}:${value};`).join('');
  return `html:root[data-theme]{${vars}--project-accent:${accent};}`;
}

/**
 * Starlight's accent properties for its dark (default) and light themes.
 * `:root:root` outranks Starlight's own `:root` rules whatever order the
 * stylesheets load in.
 */
export function starlightAccentCss(accent: string): string {
  return (
    `:root:root{--sl-color-accent-low:${mix(accent, 30, '#000')};` +
    `--sl-color-accent:${accent};--sl-color-accent-high:${mix(accent, 30, 'white')};}` +
    `:root:root[data-theme='light']{--sl-color-accent-low:${mix(accent, 20, 'white')};` +
    `--sl-color-accent:${mix(accent, 75, 'black')};--sl-color-accent-high:${mix(accent, 45, 'black')};}`
  );
}
