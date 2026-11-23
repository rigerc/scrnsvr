import { project } from '../../src/config/project.config.ts';

/**
 * The preview server the media scripts point at, without a trailing slash.
 * Defaults to Astro's dev/preview port.
 */
export const baseUrl = (process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4321').replace(/\/$/, '');

const titleEntities = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'" };

/**
 * Stops the media scripts photographing somebody else's site.
 *
 * Another project on the machine can already hold the default port, and Astro's
 * preview then quietly starts on the next free one. Playwright reaches the
 * other site, gets a 200, and writes screenshots of it with no sign anything
 * went wrong. So before any capture, fetch the home page and check that it is
 * this project's: its <title> must contain `project.name`.
 */
export async function assertTargetIsThisSite() {
  let response;
  try {
    response = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    throw new Error(
      `Cannot reach ${baseUrl}/ (${error.message}). Run \`pnpm build && pnpm preview\` first, ` +
        `and set PLAYWRIGHT_BASE_URL if the preview server is on another port.`
    );
  }
  if (!response.ok) throw new Error(`${baseUrl}/ returned ${response.status}, expected the built site.`);
  const html = await response.text();
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]
    ?.replace(/&(amp|lt|gt|quot|#39|#x27);/g, (_, entity) => titleEntities[entity])
    .trim() ?? '(no title)';
  if (!title.includes(project.name)) {
    throw new Error(
      `${baseUrl}/ is not this site: its title is "${title}" but project.name is "${project.name}". ` +
        `Another server is probably using this port. Check the port \`pnpm preview\` printed, ` +
        `and set PLAYWRIGHT_BASE_URL to it (or start preview with --port N --strictPort).`
    );
  }
}
