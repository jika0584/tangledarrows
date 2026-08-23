/**
 * Escape and recoil timings. Duration is capped so a long snake still leaves
 * the board quickly; easing supplies the acceleration.
 */
export const MIN_SLIDE_MS = 90;
export const MAX_SLIDE_MS = 220;
export const RECOIL_BACK_MS = 110;

export function slideDurationMs(distanceCells: number): number {
  const scaled = MIN_SLIDE_MS + Math.sqrt(Math.max(0, distanceCells)) * 24;
  return Math.min(MAX_SLIDE_MS, Math.max(MIN_SLIDE_MS, scaled));
}

export function recoilOutDurationMs(freeCells: number): number {
  const scaled = 45 + Math.sqrt(Math.max(0, freeCells)) * 14;
  return Math.min(90, Math.max(45, scaled));
}

/** Quick acceleration, then a cruise — readable on short and long paths. */
export function easeInQuad(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x;
}
