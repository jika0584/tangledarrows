import { Skia, SkPath } from '@shopify/react-native-skia';
import { ArrowDefinition, LevelGrid, arrowHead } from '../../levels/types';
import { BoardLayout, cellCenter } from './ArrowPath';

/** How far past the board the guides run, in board widths. */
const OVERHANG = 3;

export interface RulerGuidePaths {
  /** Every arrow's lane, minus the ones already drawn in `failed`. */
  guides: SkPath;
  /** Lanes of arrows the player has already tried and failed. */
  failed: SkPath | null;
}

/**
 * Straight-edge overlay for the ruler toggle — and for marking a mistake.
 *
 * Draws one thin line along the axis of *every* arrow, running the full length
 * of the board and well beyond it. The guides make it possible to trace a lane
 * across a crowded board and see what sits in it, but they deliberately say
 * nothing about which arrows can actually move — the player still has to read
 * the obstacles. Restricting the lines to escapable arrows would hand over the
 * answer outright.
 *
 * A failed tap is different: that arrow stays red, and when the ruler is on
 * its lane is drawn in red *under* the arrows so the pieces stay readable.
 * The line is not shown on its own — the ruler stays a toggle, not a permanent
 * hint. Arrows sharing a lane collapse onto the same guide.
 */
export function buildRulerGuides(
  arrows: readonly ArrowDefinition[],
  grid: LevelGrid,
  layout: BoardLayout,
  failedIds: ReadonlySet<string> = EMPTY_FAILED,
): RulerGuidePaths {
  const boardWidth = grid.cols * layout.cellSize;
  const boardHeight = grid.rows * layout.cellSize;
  const overhangX = boardWidth * OVERHANG;
  const overhangY = boardHeight * OVERHANG;

  const verticals = new Map<number, boolean>();
  const horizontals = new Map<number, boolean>();

  for (const arrow of arrows) {
    const { x, y } = cellCenter(arrowHead(arrow), layout);
    const failed = failedIds.has(arrow.id);
    if (arrow.direction === 'up' || arrow.direction === 'down') {
      verticals.set(x, (verticals.get(x) ?? false) || failed);
    } else {
      horizontals.set(y, (horizontals.get(y) ?? false) || failed);
    }
  }

  const guides = Skia.Path.Make();
  const failedPath = Skia.Path.Make();
  let hasFailed = false;

  const stroke = (
    target: SkPath,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ) => {
    target.moveTo(x1, y1);
    target.lineTo(x2, y2);
  };

  for (const [x, failed] of verticals) {
    const target = failed ? failedPath : guides;
    if (failed) hasFailed = true;
    stroke(target, x, layout.originY - overhangY, x, layout.originY + boardHeight + overhangY);
  }

  for (const [y, failed] of horizontals) {
    const target = failed ? failedPath : guides;
    if (failed) hasFailed = true;
    stroke(target, layout.originX - overhangX, y, layout.originX + boardWidth + overhangX, y);
  }

  return { guides, failed: hasFailed ? failedPath : null };
}

const EMPTY_FAILED: ReadonlySet<string> = new Set();
