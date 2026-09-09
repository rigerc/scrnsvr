import { fadeInOpacity, fadeOutOpacity } from './fade';

export interface CycleCrossfade {
  fadeMs: number;
  /** Overlay opacity while fading out the outgoing scene: 0 -> 1. */
  outOpacity(elapsedMs: number): number;
  /** Overlay opacity while revealing the incoming scene: 1 -> 0. */
  inOpacity(elapsedMs: number): number;
  /** Durations, clamped so each half is at least one frame at 60fps. */
  halfMs: number;
}

/**
 * Timing plan for cycling to the next shader while running: fade the black
 * overlay up over the outgoing scene, swap, then fade back down.
 */
export function cycleCrossfade(fadeSeconds: number): CycleCrossfade {
  const fadeMs = Number.isFinite(fadeSeconds) ? Math.max(0, fadeSeconds * 1000) : 0;
  const halfMs = Math.max(fadeMs / 2, 1000 / 60);
  return {
    fadeMs,
    halfMs,
    outOpacity: (elapsedMs) => fadeOutOpacity(elapsedMs, halfMs),
    inOpacity: (elapsedMs) => fadeInOpacity(elapsedMs, halfMs),
  };
}
