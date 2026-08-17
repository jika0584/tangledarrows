import {
  ArrowDefinition,
  DIRECTION_DELTA,
  GridCell,
  LevelGrid,
  arrowHead,
} from '../../levels/types';
import { OccupancyIndex, isBlocker, isInsideGrid } from './Grid';

export type SlideOutcome = 'escaped' | 'blocked';

export interface SlideResult {
  outcome: SlideOutcome;
  /**
   * Cells travelled before leaving the board (escape) or before recoiling
   * (blocked). Drives the animation distance.
   */
  distance: number;
  /** Arrow id that stopped the slide, when blocked by another arrow. */
  blockedBy?: string;
  /** Cell that caused the block — used to aim the recoil bump. */
  blockedAt?: GridCell;
}

/**
 * Resolves a tap on an arrow head.
 *
 * The arrow advances one cell at a time along its escape vector. Every cell of
 * the body must be able to advance, so the ray is cast against the *live*
 * occupancy of all other arrows plus any static blockers. Cells marked as
 * outside the board silhouette are pass-through: they shape the board without
 * walling arrows in.
 */
export function resolveSlide(
  arrow: ArrowDefinition,
  grid: LevelGrid,
  occupancy: OccupancyIndex,
): SlideResult {
  const delta = DIRECTION_DELTA[arrow.direction];

  // Enough travel to clear the board from any starting position.
  const maxSteps = grid.rows + grid.cols + arrow.cells.length;

  for (let step = 1; step <= maxSteps; step++) {
    let allOutside = true;

    for (const cell of arrow.cells) {
      const next: GridCell = {
        row: cell.row + delta.row * step,
        col: cell.col + delta.col * step,
      };

      if (!isInsideGrid(grid, next)) continue; // this part has left the board
      allOutside = false;

      if (isBlocker(grid, next)) {
        return { outcome: 'blocked', distance: step - 1, blockedAt: next };
      }

      const occupant = occupancy.occupantAt(next);
      if (occupant && occupant !== arrow.id) {
        return {
          outcome: 'blocked',
          distance: step - 1,
          blockedBy: occupant,
          blockedAt: next,
        };
      }
    }

    if (allOutside) {
      return { outcome: 'escaped', distance: step };
    }
  }

  return { outcome: 'escaped', distance: maxSteps };
}

/** Non-mutating check used by hint and preview logic. */
export function canEscape(
  arrow: ArrowDefinition,
  grid: LevelGrid,
  occupancy: OccupancyIndex,
): boolean {
  return resolveSlide(arrow, grid, occupancy).outcome === 'escaped';
}

/** The tappable cell of an arrow. */
export function tapTarget(arrow: ArrowDefinition): GridCell {
  return arrowHead(arrow);
}
