/** Cool-toned palette for remaining-arrow milestones — no warm hues (red/orange/yellow/brown). */
export const COOL_PROGRESS_PALETTE = [
  '#4169E1', // royal blue
  '#5DADE2', // light blue
  '#06B6D4', // cyan
  '#8B5CF6', // purple
  '#22C55E', // green
  '#14B8A6', // turquoise
  '#6366F1', // indigo
  '#0EA5E9', // sky blue
  '#2DD4BF', // teal
  '#7C3AED', // violet
  '#10B981', // emerald
  '#38BDF8', // bright cyan-blue
] as const;

export type ProgressMilestoneTints = {
  half: string;
  third: string;
  final: string;
};

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

/** Picks three random cool tones for the 50% / 33% / 10% milestones. */
export function pickProgressMilestoneTints(): ProgressMilestoneTints {
  return {
    half: pickRandom(COOL_PROGRESS_PALETTE),
    third: pickRandom(COOL_PROGRESS_PALETTE),
    final: pickRandom(COOL_PROGRESS_PALETTE),
  };
}

/**
 * Picks a board tint from how many arrows are still on the grid.
 * `remainingRatio` is arrowsLeft / startingCount (1 at the opening move).
 */
export function progressArrowTint(
  remainingRatio: number,
  defaultArrow: string,
  tints: ProgressMilestoneTints,
): string {
  if (remainingRatio > 0.5) return defaultArrow;
  if (remainingRatio > 1 / 3) return tints.half;
  if (remainingRatio > 0.1) return tints.third;
  return tints.final;
}
