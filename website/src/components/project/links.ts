import { withBase } from '@/lib/base';

/** Full URLs (and protocol-relative ones) open in a new tab. */
export function isExternal(href: string): boolean {
  return /^(https?:)?\/\//.test(href);
}

/** Adds the deploy's base path to internal links; leaves full URLs, `#`, `mailto:` alone. */
export function resolveHref(href: string): string {
  return withBase(href);
}
