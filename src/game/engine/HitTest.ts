import { ArrowDefinition, arrowHead } from '../../levels/types';
import { BoardLayout, cellCenter } from '../rendering/ArrowPath';
import { MIN_TOUCH_TARGET } from '../../theme/theme';

/**
 * Finds the arrow a tap was aimed at.
 *
 * Accessibility matters more than precision here: the head gets a forgiving
 * buffer that never shrinks below a comfortable physical touch target, no
 * matter how far the board is zoomed out. If no head is close enough we fall
 * back to the arrow bodies so a slightly-off tap still does something sensible.
 */
export function findTappedArrow(
  boardX: number,
  boardY: number,
  arrows: ArrowDefinition[],
  layout: BoardLayout,
  zoom: number,
): ArrowDefinition | null {
  // Buffer measured in board units; grows as the board shrinks on screen.
  const minBufferForTouch = MIN_TOUCH_TARGET / 2 / Math.max(zoom, 0.0001);
  const headBuffer = Math.max(layout.cellSize * 0.75, minBufferForTouch);

  const nearestHead = nearestArrow(
    boardX,
    boardY,
    arrows,
    layout,
    headBuffer,
    (arrow) => [arrowHead(arrow)],
  );
  if (nearestHead) return nearestHead;

  const bodyBuffer = layout.cellSize * 0.5;
  return nearestArrow(boardX, boardY, arrows, layout, bodyBuffer, (arrow) => arrow.cells);
}

function nearestArrow(
  boardX: number,
  boardY: number,
  arrows: ArrowDefinition[],
  layout: BoardLayout,
  buffer: number,
  cellsOf: (arrow: ArrowDefinition) => { row: number; col: number }[],
): ArrowDefinition | null {
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

  return best;
}
