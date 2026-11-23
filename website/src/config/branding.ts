/**
 * Brand values needed before `astro:env` exists.
 *
 * `astro.config.mjs` generates the favicon PNG/ICO files in a build hook and
 * needs the site's initial and its theme colour to do it — but it cannot
 * import `site.config.ts`, which reads `astro:env/server` and so cannot be
 * loaded at config time. Both read this plain module instead.
 *
 * Don't edit these here: set `name` and `accentColor` in `project.config.ts`.
 */
import { project } from './project.config';

export const SITE_NAME: string = project.name;

/** Browser toolbar colour, favicon fill and accent across the site. */
export const THEME_COLOR: string = project.accentColor;
