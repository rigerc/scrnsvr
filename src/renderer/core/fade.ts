export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Black-overlay opacity during fade-in: 1 -> 0. */
export function fadeInOpacity(elapsedMs: number, fadeMs: number): number {
  if (!Number.isFinite(fadeMs) || fadeMs <= 0) return 0;
  return 1 - clamp01(elapsedMs / fadeMs);
}

/** Black-overlay opacity during fade-out: 0 -> 1. */
export function fadeOutOpacity(elapsedMs: number, fadeMs: number): number {
  if (!Number.isFinite(fadeMs) || fadeMs <= 0) return 1;
  return clamp01(elapsedMs / fadeMs);
}

export interface FadeOverlay { fadeOut(close: () => void): void; destroy(): void; }

/** Fullscreen black overlay that fades in on mount and fades out on dismiss. */
export function mountFadeOverlay(host: HTMLElement, fadeSeconds: number): FadeOverlay {
  const fadeMs = Number.isFinite(fadeSeconds) ? Math.max(0, fadeSeconds * 1000) : 0;
  const overlay = host.ownerDocument.createElement('div');
  overlay.className = 'fade-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.cssText = 'position:fixed;inset:0;background:#000;pointer-events:none;z-index:10;opacity:1';
  host.append(overlay);

  let raf = 0;
  const startedAt = performance.now();
  const stepIn = (now: number) => {
    overlay.style.opacity = String(fadeInOpacity(now - startedAt, fadeMs));
    if (Number(overlay.style.opacity) > 0) raf = requestAnimationFrame(stepIn);
  };
  if (fadeMs > 0) raf = requestAnimationFrame(stepIn);
  else overlay.style.opacity = '0';

  return {
    fadeOut(close) {
      cancelAnimationFrame(raf);
      if (fadeMs <= 0) { close(); return; }
      const outStart = performance.now();
      overlay.style.opacity = '0';
      const stepOut = (now: number) => {
        overlay.style.opacity = String(fadeOutOpacity(now - outStart, fadeMs));
        if (Number(overlay.style.opacity) < 1) raf = requestAnimationFrame(stepOut);
        else close();
      };
      raf = requestAnimationFrame(stepOut);
    },
    destroy() {
      cancelAnimationFrame(raf);
      overlay.remove();
    },
  };
}
