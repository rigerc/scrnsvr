/**
 * The home page hero shares its background colour with the iOS Safari
 * toolbar by rendering the same value in CSS and a data attribute.
 *
 * Safari on iOS floats a translucent toolbar over the foot of the screen and
 * tints it from the BODY's background. The home page's hero is a dark gradient
 * in both colour modes, so in light mode the body underneath is white and a
 * white strip was drawn across the foot of the hero.
 *
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const HERO = 'src/components/project/Hero.astro';
const LAYOUT = 'src/layouts/BaseLayout.astro';
const PROJECT_CSS = 'src/styles/project.css';

describe('home page toolbar colour', () => {
  it('paints the hero with the shared background colour', () => {
    expect(read(PROJECT_CSS)).toMatch(/\.project-hero\s*\{[^}]*\bbackground:[^;}]*,\s*var\(--bg-hero\)/);
  });

  it('passes the hero colour to both CSS and the toolbar script', () => {
    const hero = read(HERO);
    expect(hero).toMatch(/backgroundColor = '#[a-f0-9]{6}'/i);
    expect(hero).toContain('data-bar-color={backgroundColor}');
    expect(hero).toContain('--bg-hero: ${backgroundColor}');
  });

  it('the script reads the attribute rather than the cascade', () => {
    const layout = read(LAYOUT);
    expect(layout).toMatch(/getAttribute\('data-bar-color'\)/);
    expect(layout).not.toMatch(/getPropertyValue\('--bar-color'\)/);
  });

  it('the paint is cleared as well as applied', () => {
    // The section stops covering the bottom edge as soon as the page moves. A
    // paint that is never cleared would sit under every section below it.
    const layout = read(LAYOUT);
    expect(layout).toMatch(/addEventListener\('scroll', onScroll/);
    expect(layout).toMatch(/const want = color \|\| '';/);
  });
});
