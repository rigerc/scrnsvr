/**
 * Single source of truth for the one project this site presents.
 *
 * - `name` and `accentColor` feed the header, favicon, social cards, docs and
 *   homepage (`branding.ts` re-exports them for build-time code).
 * - `hero` is the top of the homepage.
 * - `sections` are rendered in order below the hero. Reorder, remove or repeat
 *   them freely; a section with `nav` also appears in the header navigation.
 *
 * Headings: `\n` starts a new line, and `*text*` renders that part in the
 * accent colour. Internal links (`/docs/...`, `/#faq`) get the deploy's base
 * path added automatically; full URLs are left alone. An action or link with
 * an empty `href` is hidden, so placeholders like `demoUrl: ''` are safe.
 */

/** Any icon name accepted by `<Icon>`: a Lucide name (`book-open`) or `brand-*`. */
type IconName = string;

export interface ProjectAction {
  label: string;
  href: string;
  icon?: IconName;
  variant?: 'primary' | 'secondary';
}

export interface ProjectLink {
  label: string;
  href: string;
}

/** A terminal mockup: commands typed, then a status and output lines. */
export interface TerminalVisual {
  type: 'terminal';
  title: string;
  commands: string[];
  status?: string;
  lines?: string[];
  footer?: [string, string];
}

/** A screenshot or artwork in `public/` (e.g. `/screenshots/app.png`) or a full URL. */
export interface ImageVisual {
  type: 'image';
  src: string;
  alt: string;
  width?: number;
  height?: number;
}

/** A self-hosted video in `public/`, with playback controls. */
export interface VideoVisual {
  type: 'video';
  src: string;
  /** Text equivalent for screen readers. */
  alt: string;
  poster?: string;
}

interface SectionBase {
  /** Anchor id, so `/#<id>` links to the section. */
  id: string;
  /** Header navigation label. Omit to keep the section out of the nav. */
  nav?: string;
  kicker?: string;
  heading: string;
  lead?: string;
  /** Muted background, to separate neighbouring sections. */
  alt?: boolean;
}

export interface FeaturesSection extends SectionBase {
  type: 'features';
  items: { icon: IconName; title: string; description: string }[];
}

export interface StepsSection extends SectionBase {
  type: 'steps';
  link?: ProjectLink;
  items: { label: string; detail: string }[];
}

/**
 * A grid of screenshots or videos; the first item is shown large. An item with
 * no `image`/`video` shows a drawn placeholder (`placeholder`) until you have
 * a real capture, e.g. one from `pnpm media:capture`, copied into `public/`.
 */
export interface MediaSection extends SectionBase {
  type: 'media';
  caption?: string;
  link?: ProjectLink;
  items: {
    label: string;
    /** Short detail on the right of the label, e.g. `1440 × 900`. */
    meta?: string;
    icon?: IconName;
    image?: Omit<ImageVisual, 'type'>;
    video?: Omit<VideoVisual, 'type'>;
    placeholder?: 'desktop' | 'mobile' | 'video';
  }[];
}

export interface FaqSection extends SectionBase {
  type: 'faq';
  items: { question: string; answer: string }[];
}

export interface CtaSection extends SectionBase {
  type: 'cta';
  actions: ProjectAction[];
}

export type ProjectSection = FeaturesSection | StepsSection | MediaSection | FaqSection | CtaSection;

export function hasSectionContent(section: ProjectSection): boolean {
  return !('items' in section) || section.items.length > 0;
}

export interface ProjectConfig {
  name: string;
  /** Short description for search results, social cards and the docs. */
  description: string;
  /** Brand colour (hex). Tints the homepage, header, docs, favicon and social cards. */
  accentColor: `#${string}`;
  repository: string;
  /** Live demo or app URL. Leave empty until there is one; the button hides itself. */
  demoUrl: string;
  hero: {
    eyebrow?: string;
    headline: string;
    summary: string;
    actions: ProjectAction[];
    /** Short facts under the buttons, separated by slashes. */
    meta?: string[];
    visual?: TerminalVisual | ImageVisual | VideoVisual;
    /** Two small labels along the bottom edge of the hero. */
    footer?: string[];
  };
  sections: ProjectSection[];
}

const repository = 'https://github.com/rigerc/scrnsvr';
const download = `${repository}/releases/latest`;

export const project: ProjectConfig = {
  name: 'scrnsvr',
  description: 'A native shader screensaver for Hyprland. Browse GLSL visuals, layer effects, and make idle time your own.',
  accentColor: '#ef7b4d',
  repository,
  demoUrl: '',
  hero: {
    headline: 'A shader screensaver for *Hyprland.*',
    summary: 'Give your idle screen a new look. Pick a GLSL shader, tune it in a live preview, and add effects or a clock.',
    actions: [
      { label: 'Download AppImage', href: download, icon: 'download', variant: 'primary' },
      { label: 'Install guide', href: '/docs/install/', variant: 'secondary' },
    ],
    visual: {
      type: 'image',
      src: '/media/app/fullscreen.webp',
      alt: 'The scrnsvr clock over the green and blue Aurora Veil shader',
      width: 1600,
      height: 900,
    },
  },
  sections: [
    {
      type: 'steps',
      id: 'workflow',
      heading: 'Set it up in three steps',
      lead: 'Hyprland on Wayland is the supported desktop. The release AppImage targets Linux x86-64.',
      link: { label: 'Read the install guide', href: '/docs/install/' },
      items: [
        { label: 'Download and verify', detail: 'Get the AppImage and matching SHA-256 checksum from the latest release.' },
        { label: 'Install the command', detail: 'Make the AppImage executable and run it with --install.' },
        { label: 'Start it when idle', detail: 'Set up Noctalia or hypridle to run scrnsvr --open after your desktop has been idle.' },
      ],
    },
  ],
};
