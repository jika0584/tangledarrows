import { ArrowDefinition, DIRECTION_DELTA, LevelGrid, arrowHead } from '../../levels/types';
import { BoardLayout } from '../rendering/ArrowPath';
import { OccupancyIndex } from './Grid';
import { canEscape } from './Collision';

export type PaddingSize = 'none' | 'small' | 'big';
export type TapZoneSize = 'small' | 'medium' | 'large';

/** Extra reach past the tip, in cells. */
export const HEAD_PADDING: Record<PaddingSize, number> = {
  none: 0,
  small: 0.24,
  big: 0.5,
};

/** Extra reach past a body/tail square, in cells. */
export const TAIL_PADDING: Record<PaddingSize, number> = {
  none: 0,
  small: 0.2,
  big: 0.4,
};

/** View-space radius of the tap halo. */
export const TAP_ZONE_RADIUS: Record<TapZoneSize, number> = {
  small: 10,
  medium: 18,
  large: 28,
};

export interface TapResolveOptions {
  headPadding?: PaddingSize;
  tailPadding?: PaddingSize;
}

const DEFAULT_OPTIONS: Required<TapResolveOptions> = {
  headPadding: 'small',
  tailPadding: 'none',
};

/**
 * Finds the arrow a tap was aimed at.
 *
 * Escapable arrows get the configured head/tail padding. Everything else only
 * counts when the tap is on one of its own squares, so a padded free head
 * cannot steal a tap that landed on a blocked neighbour.
 */
export function findTappedArrow(
  boardX: number,
  boardY: number,
  arrows: ArrowDefinition[],
  layout: BoardLayout,
  _zoom: number,
  grid: LevelGrid,
  options: TapResolveOptions = DEFAULT_OPTIONS,
): ArrowDefinition | null {
  const { cellSize } = layout;
  const headReach = cellSize * HEAD_PADDING[options.headPadding ?? DEFAULT_OPTIONS.headPadding];
  const tailReach = cellSize * TAIL_PADDING[options.tailPadding ?? DEFAULT_OPTIONS.tailPadding];

  const occupancy = new OccupancyIndex(arrows);
  const escapable = new Set(
    arrows.filter((arrow) => canEscape(arrow, grid, occupancy)).map((arrow) => arrow.id),
  );
  const freeArrows = arrows.filter((arrow) => escapable.has(arrow.id));

  const col = Math.floor((boardX - layout.originX) / cellSize);
  const row = Math.floor((boardY - layout.originY) / cellSize);
  const exact =
    arrows.find((arrow) => arrow.cells.some((cell) => cell.row === row && cell.col === col)) ??
    null;

  const head = nearestHead(boardX, boardY, freeArrows, layout, headReach);
  const tail = nearestTail(boardX, boardY, freeArrows, layout, tailReach);

  if (exact) {
    // A padded free head only overrides another square when the tap is closer
    // to that tip than to the cell the finger is actually on.
    if (head && head.arrow.id !== exact.id && head.distance < distanceToOccupiedCell(boardX, boardY, exact, layout)) {
      return head.arrow;
    }
    return exact;
  }

  if (head && (!tail || head.distance <= tail.distance)) return head.arrow;
  return tail?.arrow ?? null;
}

export function headTip(arrow: ArrowDefinition, layout: BoardLayout): { x: number; y: number } {
  const head = arrowHead(arrow);
  const delta = DIRECTION_DELTA[arrow.direction];
  return {
    x: layout.originX + (head.col + 0.5 + delta.col * 0.48) * layout.cellSize,
    y: layout.originY + (head.row + 0.5 + delta.row * 0.48) * layout.cellSize,
  };
}

function distanceToCell(
  boardX: number,
  boardY: number,
  cell: { row: number; col: number },
  layout: BoardLayout,
): number {
  const left = layout.originX + cell.col * layout.cellSize;
  const top = layout.originY + cell.row * layout.cellSize;
  const dx = Math.max(left - boardX, 0, boardX - (left + layout.cellSize));
  const dy = Math.max(top - boardY, 0, boardY - (top + layout.cellSize));
  return Math.hypot(dx, dy);
}

function distanceToOccupiedCell(
  boardX: number,
  boardY: number,
  arrow: ArrowDefinition,
  layout: BoardLayout,
): number {
  let best = Number.POSITIVE_INFINITY;
  for (const cell of arrow.cells) {
    best = Math.min(best, distanceToCell(boardX, boardY, cell, layout));
  }
  return best;
}

function nearestHead(
  boardX: number,
  boardY: number,
  arrows: ArrowDefinition[],
  layout: BoardLayout,
  buffer: number,
): { arrow: ArrowDefinition; distance: number } | null {
  let best: ArrowDefinition | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const arrow of arrows) {
    const tip = headTip(arrow, layout);
    const distance = Math.hypot(tip.x - boardX, tip.y - boardY);
    if (distance > buffer) continue;
    if (distance < bestDistance) {
      best = arrow;
      bestDistance = distance;
    }
  }

  return best ? { arrow: best, distance: bestDistance } : null;
}

function nearestTail(
  boardX: number,
  boardY: number,
  arrows: ArrowDefinition[],
  layout: BoardLayout,
  buffer: number,
): { arrow: ArrowDefinition; distance: number } | null {
  if (buffer <= 0) return null;

  let best: ArrowDefinition | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const head = (arrow: ArrowDefinition) => arrowHead(arrow);

  for (const arrow of arrows) {
    const tip = head(arrow);
    for (const cell of arrow.cells) {
      if (cell.row === tip.row && cell.col === tip.col) continue;
      const distance = distanceToCell(boardX, boardY, cell, layout);
      if (distance <= buffer && distance < bestDistance) {
        best = arrow;
        bestDistance = distance;
      }
    }
  }

  return best ? { arrow: best, distance: bestDistance } : null;
}

export function escapableArrows(
  arrows: ArrowDefinition[],
  grid: LevelGrid,
): ArrowDefinition[] {
  const occupancy = new OccupancyIndex(arrows);
  return arrows.filter((arrow) => canEscape(arrow, grid, occupancy));
}
