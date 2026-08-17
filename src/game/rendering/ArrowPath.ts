import { Skia, SkPath } from '@shopify/react-native-skia';
import { ArrowDefinition, DIRECTION_DELTA, GridCell } from '../../levels/types';

export interface BoardLayout {
  /** Pixel size of one grid cell at zoom 1. */
  cellSize: number;
  /** Pixel offset of the board origin inside the canvas. */
  originX: number;
  originY: number;
}

/** Centre point of a grid cell in board pixel space. */
export function cellCenter(cell: GridCell, layout: BoardLayout): { x: number; y: number } {
  return {
    x: layout.originX + (cell.col + 0.5) * layout.cellSize,
    y: layout.originY + (cell.row + 0.5) * layout.cellSize,
  };
}

/**
 * Builds the arrow shaft as a rounded polyline through its cell centres.
 * The head is drawn separately so the tip stays crisp at any zoom level.
 */
export function buildShaftPath(arrow: ArrowDefinition, layout: BoardLayout): SkPath {
  const path = Skia.Path.Make();
  const points = arrow.cells.map((cell) => cellCenter(cell, layout));
  if (points.length === 0) return path;

  // Stop the shaft short of the tip so the arrowhead reads cleanly.
  const delta = DIRECTION_DELTA[arrow.direction];
  const inset = layout.cellSize * 0.32;
  const last = points[points.length - 1];
  const shaftEnd = {
    x: last.x - delta.col * inset,
    y: last.y - delta.row * inset,
  };

  path.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i++) {
    path.lineTo(points[i].x, points[i].y);
  }
  path.lineTo(shaftEnd.x, shaftEnd.y);

  return path;
}

/** Builds the triangular arrowhead at the tip cell. */
export function buildHeadPath(arrow: ArrowDefinition, layout: BoardLayout): SkPath {
  const path = Skia.Path.Make();
  const head = arrow.cells[arrow.cells.length - 1];
  const centre = cellCenter(head, layout);
  const delta = DIRECTION_DELTA[arrow.direction];

  const reach = layout.cellSize * 0.34;
  const halfWidth = layout.cellSize * 0.26;

  // Perpendicular vector for the two base corners.
  const perp = { x: -delta.row, y: delta.col };

  const tip = {
    x: centre.x + delta.col * reach,
    y: centre.y + delta.row * reach,
  };
  const baseCentre = {
    x: centre.x - delta.col * reach * 0.35,
    y: centre.y - delta.row * reach * 0.35,
  };

  path.moveTo(tip.x, tip.y);
  path.lineTo(baseCentre.x + perp.x * halfWidth, baseCentre.y + perp.y * halfWidth);
  path.lineTo(baseCentre.x - perp.x * halfWidth, baseCentre.y - perp.y * halfWidth);
  path.close();

  return path;
}

/** Rounded outline of the playable board silhouette. */
export function buildBoardShapePath(
  matrix: readonly (readonly number[])[],
  layout: BoardLayout,
  floorValue = 0,
): SkPath {
  const path = Skia.Path.Make();
  const { cellSize, originX, originY } = layout;

  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      if (matrix[r][c] !== floorValue) continue;
      path.addRect(
        Skia.XYWHRect(
          originX + c * cellSize,
          originY + r * cellSize,
          cellSize,
          cellSize,
        ),
      );
    }
  }

  return path;
}
