import { MAX_LIVES } from '../../levels/types';

export interface ScoreLine {
  label: string;
  points: number;
}

export interface LevelScoreInput {
  elapsedMs: number;
  heartsEnabled: boolean;
  lives: number;
  perfect: boolean;
  mistakeCount: number;
  /** Each combo streak of 2+ that was achieved this run. */
  comboPayouts: readonly number[];
}

export interface LevelScoreResult {
  lines: ScoreLine[];
  total: number;
}

/** +100 at 2, +150 at 3, +220 at 4, +300 at 5, then +80 per step. */
export function comboPoints(comboSize: number): number {
  if (comboSize < 2) return 0;
  if (comboSize === 2) return 100;
  if (comboSize === 3) return 150;
  if (comboSize === 4) return 220;
  if (comboSize === 5) return 300;
  return 300 + (comboSize - 5) * 80;
}

export function comboSizeLabel(comboSize: number): string {
  if (comboSize === 2) return 'Double';
  if (comboSize === 3) return 'Triple';
  if (comboSize === 4) return 'Quad';
  if (comboSize === 5) return 'Penta';
  return `${comboSize}`;
}

/** Base time table ×10 so time dominates the final total. */
export function timeBonusPoints(elapsedMs: number): number {
  const minutes = elapsedMs / 60_000;
  let base: number;
  if (minutes < 3) base = 3000;
  else if (minutes < 4) base = 2500;
  else if (minutes < 5) base = 2200;
  else if (minutes < 6) base = 2000;
  else {
    const extraMinutes = Math.floor(minutes - 6);
    base = Math.max(500, 2000 - extraMinutes * 200);
  }
  return base * 10;
}

export function computeLevelScore(input: LevelScoreInput): LevelScoreResult {
  const lines: ScoreLine[] = [];

  if (input.heartsEnabled) {
    const heartPoints = input.lives * 500;
    if (heartPoints > 0) {
      lines.push({
        label: `Hearts (${input.lives}/${MAX_LIVES})`,
        points: heartPoints,
      });
    }
    if (input.perfect) {
      lines.push({ label: 'Perfect clear', points: 220 });
    }
  } else if (input.mistakeCount > 0) {
    lines.push({
      label: `Misclicks (${input.mistakeCount})`,
      points: -50 * input.mistakeCount,
    });
  }

  lines.push({ label: 'Time bonus', points: timeBonusPoints(input.elapsedMs) });

  // Aggregate identical combo sizes: "5 × Double combo", "10 × 13 combo", …
  const bySize = new Map<number, { count: number; points: number }>();
  for (const size of input.comboPayouts) {
    if (size < 2) continue;
    const existing = bySize.get(size) ?? { count: 0, points: 0 };
    existing.count += 1;
    existing.points += comboPoints(size);
    bySize.set(size, existing);
  }

  const sizes = [...bySize.keys()].sort((a, b) => a - b);
  for (const size of sizes) {
    const { count, points } = bySize.get(size)!;
    const name = comboSizeLabel(size);
    lines.push({
      label: `${count} × ${name} combo`,
      points,
    });
  }

  const total = lines.reduce((sum, line) => sum + line.points, 0);
  return { lines, total: Math.max(0, total) };
}
