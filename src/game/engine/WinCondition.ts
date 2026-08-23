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
