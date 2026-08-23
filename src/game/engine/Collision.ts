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
   * How far the arrow advances along its travel path, measured in cells.
   * On escape this covers the whole body leaving the board; on a block it is
   * the free run before the recoil.
   */
  distance: number;
  /** Steps the head itself can advance before something stops it. */
  headSteps: number;
  /** Arrow id that stopped the slide, when blocked by another arrow. */
  blockedBy?: string;
  /** Cell that caused the block — used to aim the recoil bump. */
  blockedAt?: GridCell;
}

/**
 * Resolves a tap on an arrow head.
 *
 * Arrows move like a snake: the head advances along its escape vector and every
 * other segment follows the path the segment ahead of it just left. Because the
 * body only ever moves into cells the arrow already occupies, it can never
 * collide with anything — so the entire outcome is decided by casting a single
 * ray from the head against the live occupancy of the other arrows.
 *
 * Cells outside the board silhouette are pass-through; they shape the board
 * without walling arrows in.
 */
export function resolveSlide(
  arrow: ArrowDefinition,
  grid: LevelGrid,
  occupancy: OccupancyIndex,
): SlideResult {
  const delta = DIRECTION_DELTA[arrow.direction];
  const head = arrowHead(arrow);
  const bodyCells = arrow.cells.length;

  // Bounded by the board diagonal; the head must leave within this many steps.
  const maxSteps = grid.rows + grid.cols + 2;

  for (let step = 1; step <= maxSteps; step++) {
    const next: GridCell = {
      row: head.row + delta.row * step,
      col: head.col + delta.col * step,
    };

    if (!isInsideGrid(grid, next)) {
      // Head is clear of the board; the tail needs the body length to follow.
      return {
        outcome: 'escaped',
        distance: step + bodyCells - 1,
        headSteps: step,
      };
    }

    if (isBlocker(grid, next)) {
      return {
        outcome: 'blocked',
        distance: step - 1,
        headSteps: step - 1,
        blockedAt: next,
      };
    }

    const occupant = occupancy.occupantAt(next);
    if (occupant && occupant !== arrow.id) {
      return {
        outcome: 'blocked',
        distance: step - 1,
        headSteps: step - 1,
        blockedBy: occupant,
        blockedAt: next,
      };
    }
  }

  return {
    outcome: 'escaped',
    distance: maxSteps + bodyCells - 1,
    headSteps: maxSteps,
  };
}

/** Non-mutating check used by hint, generator and solvability logic. */
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
