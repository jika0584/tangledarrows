import { Skia, SkPath } from '@shopify/react-native-skia';
import { ArrowDefinition, DIRECTION_DELTA, GridCell, LevelGrid } from '../../levels/types';

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
 * Everything needed to draw an arrow at any point along its escape.
 *
 * The arrow snakes rather than translating, so its shape at a given moment is a
 * fixed-length window sliding along one continuous path: the body from tail to
 * head, extended straight past the board edge. Rendering therefore reduces to
 * trimming that single path, which Skia does on the GPU without rebuilding
 * geometry per frame.
 */
export interface ArrowGeometry {
  /** Tail → head → off-board extension, as one polyline. */
  travelPath: SkPath;
  /** Arrowhead triangle pointing along +x, centred on the origin. */
  headPath: SkPath;
  /** Flat point arrays, kept worklet-friendly for tangent lookups. */
  xs: number[];
  ys: number[];
  /** Cumulative path distance at each point. */
  cumulative: number[];
  /** Distance from tail to head along the body. */
  bodyLength: number;
  totalLength: number;
  /** How far the shaft stops short of the tip so the head reads cleanly. */
  headInset: number;
}

export function buildArrowGeometry(
  arrow: ArrowDefinition,
  layout: BoardLayout,
  grid: LevelGrid,
): ArrowGeometry {
  const delta = DIRECTION_DELTA[arrow.direction];
  const bodyPoints = arrow.cells.map((cell) => cellCenter(cell, layout));
  const head = arrow.cells[arrow.cells.length - 1];

  // Extend far enough that the tail also clears the board.
  const extensionCells = grid.rows + grid.cols + arrow.cells.length + 2;
  const points = [...bodyPoints];
  for (let i = 1; i <= extensionCells; i++) {
    points.push(
      cellCenter({ row: head.row + delta.row * i, col: head.col + delta.col * i }, layout),
    );
  }

  const xs: number[] = [];
  const ys: number[] = [];
  const cumulative: number[] = [];
  let running = 0;

  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      running += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    xs.push(points[i].x);
    ys.push(points[i].y);
    cumulative.push(running);
  }

  const travelPath = Skia.Path.Make();
  travelPath.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    travelPath.lineTo(points[i].x, points[i].y);
  }

  return {
    travelPath,
    headPath: buildHeadPath(layout.cellSize),
    xs,
    ys,
    cumulative,
    bodyLength: cumulative[arrow.cells.length - 1],
    totalLength: running,
    // The shaft runs all the way into the base of the head so the two read as
    // one continuous piece rather than a line with a floating tip.
    headInset: layout.cellSize * HEAD_BACK,
  };
}

/** Arrowhead geometry as a fraction of a cell. */
const HEAD_REACH = 0.48;
const HEAD_BACK = 0.22;
const HEAD_HALF_WIDTH = 0.34;

/** Arrowhead as a triangle pointing along +x, so it can simply be rotated. */
function buildHeadPath(cellSize: number): SkPath {
  const path = Skia.Path.Make();

  path.moveTo(cellSize * HEAD_REACH, 0);
  path.lineTo(-cellSize * HEAD_BACK, cellSize * HEAD_HALF_WIDTH);
  path.lineTo(-cellSize * HEAD_BACK, -cellSize * HEAD_HALF_WIDTH);
  path.close();

  return path;
}

export interface PosTan {
  x: number;
  y: number;
  /** Tangent angle in radians, for rotating the arrowhead. */
  angle: number;
}

/**
 * Position and heading at a distance along the polyline.
 * Worklet-safe: operates only on plain number arrays.
 */
export function posTanAt(
  xs: number[],
  ys: number[],
  cumulative: number[],
  distance: number,
): PosTan {
  'worklet';
  const last = cumulative.length - 1;

  if (distance <= 0) {
    return { x: xs[0], y: ys[0], angle: Math.atan2(ys[1] - ys[0], xs[1] - xs[0]) };
  }
  if (distance >= cumulative[last]) {
    return {
      x: xs[last],
      y: ys[last],
      angle: Math.atan2(ys[last] - ys[last - 1], xs[last] - xs[last - 1]),
    };
  }

  // Segments are uniform in length, so jump straight to the right one.
  let index = 1;
  while (index < last && cumulative[index] < distance) index++;

  const segmentLength = cumulative[index] - cumulative[index - 1];
  const t = segmentLength === 0 ? 0 : (distance - cumulative[index - 1]) / segmentLength;
  const dx = xs[index] - xs[index - 1];
  const dy = ys[index] - ys[index - 1];

  return {
    x: xs[index - 1] + dx * t,
    y: ys[index - 1] + dy * t,
    angle: Math.atan2(dy, dx),
  };
}

/** Filled outline of the playable board silhouette. */
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
        Skia.XYWHRect(originX + c * cellSize, originY + r * cellSize, cellSize, cellSize),
      );
    }
  }

  return path;
}

/**
 * A discreet dot at the centre of every playable cell — the lattice the
 * original game used instead of a filled silhouette.
 */
export function buildGridDotsPath(
  matrix: readonly (readonly number[])[],
  layout: BoardLayout,
  floorValue = 0,
): SkPath {
  const path = Skia.Path.Make();
  const radius = Math.max(1, layout.cellSize * 0.07);

  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      if (matrix[r][c] !== floorValue) continue;
      const { x, y } = cellCenter({ row: r, col: c }, layout);
      path.addCircle(x, y, radius);
    }
  }

  return path;
}
