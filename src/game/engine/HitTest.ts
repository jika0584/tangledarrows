import { ArrowDefinition, LevelGrid, arrowHead } from '../../levels/types';
import { BoardLayout, cellCenter } from '../rendering/ArrowPath';
import { MIN_TOUCH_TARGET } from '../../theme/theme';
import { OccupancyIndex } from './Grid';
import { canEscape } from './Collision';

/** Free arrows get this much extra reach — a sliver, not a magnet. */
const GOOD_BUFFER_SCALE = 1.12;

/**
 * Finds the arrow a tap was aimed at.
 *
 * Accessibility matters more than precision here: the head gets a forgiving
 * buffer that never shrinks below a comfortable physical touch target, no
 * matter how far the board is zoomed out. If no head is close enough we fall
 * back to the arrow bodies so a slightly-off tap still does something sensible.
 *
 * Escapable arrows get a slightly larger buffer than blocked ones so a tap
 * that lands in the gap between a free head and a neighbour prefers the free
 * piece — without turning the whole board into a hit-anywhere mode.
 */
export function findTappedArrow(
  boardX: number,
  boardY: number,
  arrows: ArrowDefinition[],
  layout: BoardLayout,
  zoom: number,
  grid: LevelGrid,
): ArrowDefinition | null {
  const occupancy = new OccupancyIndex(arrows);
  const goodIds = new Set(
    arrows
      .filter((arrow) => canEscape(arrow, grid, occupancy))
      .map((arrow) => arrow.id),
  );
  const goodArrows = arrows.filter((arrow) => goodIds.has(arrow.id));
  const blockedArrows = arrows.filter((arrow) => !goodIds.has(arrow.id));

  const col = Math.floor((boardX - layout.originX) / layout.cellSize);
  const row = Math.floor((boardY - layout.originY) / layout.cellSize);
  const exact = arrows.find((arrow) =>
    arrow.cells.some((cell) => cell.row === row && cell.col === col),
  );

  const minBufferForTouch = MIN_TOUCH_TARGET / 2 / Math.max(zoom, 0.0001);
  const headBuffer = Math.max(layout.cellSize * 0.75, minBufferForTouch);
  const goodHeadBuffer = headBuffer * GOOD_BUFFER_SCALE;
  const leeway = layout.cellSize * 0.18;

  const goodHead = nearestArrow(
    boardX,
    boardY,
    goodArrows,
    layout,
    goodHeadBuffer,
    (arrow) => [arrowHead(arrow)],
  );
  const blockedHead = nearestArrow(
    boardX,
    boardY,
    blockedArrows,
    layout,
    headBuffer,
    (arrow) => [arrowHead(arrow)],
  );

  if (exact && goodIds.has(exact.id)) return exact;

  if (goodHead) {
    const blockedDistance = blockedHead?.distance ?? Number.POSITIVE_INFINITY;
    const exactIsBlocked = !!exact && !goodIds.has(exact.id);
    if (exactIsBlocked) {
      if (goodHead.distance <= blockedDistance + leeway || goodHead.distance <= layout.cellSize * 0.55) {
        return goodHead.arrow;
      }
    } else if (!blockedHead || goodHead.distance <= blockedDistance + leeway) {
      return goodHead.arrow;
    }
  }

  if (exact) return exact;
  if (blockedHead) return blockedHead.arrow;

  const bodyBuffer = layout.cellSize * 0.5;
  const goodBody = nearestArrow(boardX, boardY, goodArrows, layout, bodyBuffer * GOOD_BUFFER_SCALE, (arrow) => arrow.cells);
  const blockedBody = nearestArrow(boardX, boardY, blockedArrows, layout, bodyBuffer, (arrow) => arrow.cells);
  if (goodBody && (!blockedBody || goodBody.distance <= blockedBody.distance + leeway)) {
    return goodBody.arrow;
  }
  return blockedBody?.arrow ?? null;
}

function nearestArrow(
  boardX: number,
  boardY: number,
  arrows: ArrowDefinition[],
  layout: BoardLayout,
  buffer: number,
  cellsOf: (arrow: ArrowDefinition) => { row: number; col: number }[],
): { arrow: ArrowDefinition; distance: number } | null {
  let best: ArrowDefinition | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const arrow of arrows) {
    for (const cell of cellsOf(arrow)) {
      const centre = cellCenter(cell, layout);
      const distance = Math.hypot(centre.x - boardX, centre.y - boardY);
      if (distance <= buffer && distance < bestDistance) {
        bestDistance = distance;
        best = arrow;
      }
    }
  }

  return best ? { arrow: best, distance: bestDistance } : null;
}
