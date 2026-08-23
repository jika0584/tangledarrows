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

export function timeBonusPoints(elapsedMs: number): number {
  const minutes = elapsedMs / 60_000;
  if (minutes < 3) return 3000;
  if (minutes < 4) return 2500;
  if (minutes < 5) return 2200;
  if (minutes < 6) return 2000;
  const extraMinutes = Math.floor(minutes - 6);
  return Math.max(500, 2000 - extraMinutes * 200);
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

  const timePoints = timeBonusPoints(input.elapsedMs);
  lines.push({ label: 'Time bonus', points: timePoints });

  for (const comboSize of input.comboPayouts) {
    lines.push({
      label: `Combo x${comboSize}`,
      points: comboPoints(comboSize),
    });
  }

  const total = lines.reduce((sum, line) => sum + line.points, 0);
  return { lines, total: Math.max(0, total) };
}
