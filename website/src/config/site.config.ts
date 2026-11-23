import { SITE_URL, GOOGLE_SITE_VERIFICATION, BING_SITE_VERIFICATION } from 'astro:env/server';
import i18nConfig, { type I18nConfig } from './i18n.config';
import { SITE_URL_FALLBACK } from './site-url';
import { SITE_NAME, THEME_COLOR } from './branding';
import { project } from './project.config';
import { withBase } from '../lib/base';

export { i18nConfig };
export type { I18nConfig };

export interface SiteConfig {
  name: string;
  description: string;
  /** Identity line under the logo in the centered footer */
  tagline?: string;
  /** Short facts line under the footer tagline (licensing, location, availability) */
  footerNote?: string;
  url: string;
  ogImage: string;
  author: string;
  email: string;
  phone?: string;
  address?: {
    street: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  socialLinks: string[];
  /**
   * Header options. Set `showSocialLinks: true` to render an icon link in the
   * top-right for each entry in `socialLinks` (GitHub, X, etc. — the icon is
   * inferred from the URL). Off by default; an explicit `<Header
   * showSocialLinks>` prop still overrides this per-usage.
   */
  header?: {
    showSocialLinks?: boolean;
  };
  twitter?: {
    site: string;
    creator: string;
  };
  verification?: {
    google?: string;
    bing?: string;
  };
  /** Path to author photo (relative to site root, e.g. '/avatar.jpg'). Used in Person schema. */
  authorImage?: string;
  /**
   * Global, decorative visual effects (purely additive — the site works
   * fully without them).
   */
  effects?: {
    /**
     * Cursor trail on desktop (pointer dot + lagging ring + comet particles).
     * `true` by default; set to `false` to turn it off site-wide as a
     * visual-comfort / accessibility preference. The trail is already skipped
     * automatically under `prefers-reduced-motion` and on coarse/touch
     * pointers, regardless of this flag.
     */
    cursorTrail?: boolean;
  };
  /**
   * Internationalization (i18n) — see `src/config/i18n.config.ts`.
   * Lives in a separate file so the i18n module can be imported by
   * unit tests without pulling in `astro:env/server`.
   */
  i18n?: I18nConfig;
  /**
   * Branding configuration
   * Logo files: Replace SVGs in src/assets/branding/
   * Favicon: Replace in public/favicon.svg
   */
  branding: {
    /** Logo alt text for accessibility */
    logo: {
      alt: string;
      /**
       * Optional path to a custom logo image in public/ (e.g. '/logo.svg').
       * When set, it replaces the generated letter-monogram badge in the
       * header, footer, and anywhere <Logo> is rendered — no layout edits
       * needed. Leave unset to keep the monogram. Per-author byline avatars
       * (which pass an explicit letter) are unaffected.
       */
      image?: string;
      /** Path to logo image for structured data (e.g. '/logo.png'). Add a PNG to public/ and set this. */
      imageUrl?: string;
    };
    /** Favicon path (lives in public/) */
    favicon: {
      svg: string;
    };
    /** Theme colors for manifest and browser UI */
    colors: {
      /** Browser toolbar color (hex) */
      themeColor: string;
      /** PWA splash screen background (hex) */
      backgroundColor: string;
    };
  };
}

const siteConfig: SiteConfig = {
  // Read from ./branding so the build-time favicon generator, which cannot
  // import this file, uses the same values from project.config.ts.
  name: SITE_NAME,
  description: project.description,
  tagline: 'A shader screensaver for Hyprland.',
  footerNote: 'Built with Astro Rocket and Starlight',
  url: SITE_URL || SITE_URL_FALLBACK,
  // Generated at build time from `name`, `tagline` and the brand colour below.
  // Point this at a file in `public/` to use your own — it has to be a raster
  // (PNG or JPEG): social platforms don't render SVG share images.
  ogImage: withBase('/og/default.png'),
  author: 'rigerc',
  email: '',
  socialLinks: [project.repository],
  header: {
    // Flip to `true` to show the social icons (incl. GitHub) in the header.
    showSocialLinks: false,
  },
  verification: {
    google: GOOGLE_SITE_VERIFICATION,
    bing: BING_SITE_VERIFICATION,
  },
  authorImage: undefined,
  effects: {
    cursorTrail: false,
  },
  i18n: i18nConfig,
  branding: {
    logo: {
      alt: SITE_NAME,
      image: withBase('/scrnsvr.svg'),
      imageUrl: withBase('/scrnsvr.svg'),
    },
    favicon: {
      svg: withBase('/scrnsvr.svg'),
    },
    colors: {
      themeColor: THEME_COLOR,
      backgroundColor: '#ffffff',
    },
  },
};

export default siteConfig;
