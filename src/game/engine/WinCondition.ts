import { Level } from '../../levels/types';
import { OccupancyIndex } from './Grid';
import { canEscape } from './Collision';
import { BoardState } from './Movement';

/** The board is cleared when every arrow has escaped. */
export function hasWon(state: BoardState): boolean {
  return state.arrows.length === 0;
}

export function hasLost(state: BoardState): boolean {
  return state.status === 'lost';
}

/** Ids of arrows that can escape right now — powers the hint button. */
export function escapableArrowIds(state: BoardState): string[] {
  const occupancy = new OccupancyIndex(state.arrows);
  return state.arrows
    .filter((arrow) => canEscape(arrow, state.level.grid, occupancy))
    .map((arrow) => arrow.id);
}

/**
 * Arrows that can never clear from the current layout: greedy peeling gets stuck
 * with these still on the board. Empty on solvable levels; useful when hand-drawing.
 */
export function neverEscapableArrowIds(level: Level): string[] {
  let remaining = level.arrows.map((arrow) => ({
    ...arrow,
    cells: arrow.cells.map((cell) => ({ ...cell })),
  }));

  while (remaining.length > 0) {
    const occupancy = new OccupancyIndex(remaining);
    const escapable = remaining.find((arrow) => canEscape(arrow, level.grid, occupancy));
    if (!escapable) return remaining.map((arrow) => arrow.id);
    remaining = remaining.filter((arrow) => arrow.id !== escapable.id);
  }

  return [];
}

/** Ids of arrows blocked in the current position (may still clear later). */
export function blockedArrowIds(state: BoardState): string[] {
  const open = new Set(escapableArrowIds(state));
  return state.arrows.filter((arrow) => !open.has(arrow.id)).map((arrow) => arrow.id);
}

/**
 * Verifies a level is fully solvable by greedily clearing escapable arrows.
 * Used to validate curated levels and to smoke-test the generator.
 */
export function isSolvable(level: Level): boolean {
  let remaining = level.arrows.map((arrow) => ({ ...arrow }));

  while (remaining.length > 0) {
    const occupancy = new OccupancyIndex(remaining);
    const escapable = remaining.find((arrow) => canEscape(arrow, level.grid, occupancy));
    if (!escapable) return false;
    remaining = remaining.filter((arrow) => arrow.id !== escapable.id);
  }

  return true;
}
