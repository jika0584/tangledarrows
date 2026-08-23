import {
  ArrowDefinition,
  CELL_BLOCKER,
  CELL_FLOOR,
  DIRECTION_DELTA,
  GridCell,
  LevelGrid,
  arrowHead,
} from '../../../src/levels/types';

export interface Layout {
  cellSize: number;
  originX: number;
  originY: number;
}

export function fitLayout(
  grid: LevelGrid,
  width: number,
  height: number,
  padding = 36,
): Layout {
  const usableWidth = Math.max(1, width - padding * 2);
  const usableHeight = Math.max(1, height - padding * 2);
  const cellSize = Math.max(8, Math.min(usableWidth / grid.cols, usableHeight / grid.rows));
  return {
    cellSize,
    originX: (width - cellSize * grid.cols) / 2,
    originY: (height - cellSize * grid.rows) / 2,
  };
}

export function cellCenter(cell: GridCell, layout: Layout): { x: number; y: number } {
  return {
    x: layout.originX + (cell.col + 0.5) * layout.cellSize,
    y: layout.originY + (cell.row + 0.5) * layout.cellSize,
  };
}

export interface TravelPath {
  xs: number[];
  ys: number[];
  cumulative: number[];
  bodyLength: number;
}

export function travelPath(arrow: ArrowDefinition, layout: Layout, grid: LevelGrid): TravelPath {
  const delta = DIRECTION_DELTA[arrow.direction];
  const head = arrowHead(arrow);
  const points = arrow.cells.map((cell) => cellCenter(cell, layout));
  const extra = grid.rows + grid.cols + arrow.cells.length + 2;
  for (let i = 1; i <= extra; i++) {
    points.push(
      cellCenter({ row: head.row + delta.row * i, col: head.col + delta.col * i }, layout),
    );
  }

  const xs: number[] = [];
  const ys: number[] = [];
  const cumulative: number[] = [];
  let running = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) running += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    xs.push(points[i].x);
    ys.push(points[i].y);
    cumulative.push(running);
  }

  return {
    xs,
    ys,
    cumulative,
    bodyLength: cumulative[arrow.cells.length - 1] ?? 0,
  };
}

export function posTanAt(
  xs: number[],
  ys: number[],
  cumulative: number[],
  distance: number,
): { x: number; y: number; angle: number } {
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

export function hitArrow(
  boardX: number,
  boardY: number,
  arrows: ArrowDefinition[],
  layout: Layout,
): ArrowDefinition | null {
  const col = Math.floor((boardX - layout.originX) / layout.cellSize);
  const row = Math.floor((boardY - layout.originY) / layout.cellSize);
  const exact = arrows.find((arrow) =>
    arrow.cells.some((cell) => cell.row === row && cell.col === col),
  );
  if (exact) return exact;

  const buffer = layout.cellSize * 0.7;
  let best: ArrowDefinition | null = null;
  let bestDistance = buffer;
  for (const arrow of arrows) {
    const centre = cellCenter(arrowHead(arrow), layout);
    const distance = Math.hypot(centre.x - boardX, centre.y - boardY);
    if (distance < bestDistance) {
      best = arrow;
      bestDistance = distance;
    }
  }
  return best;
}

export function arrowsInRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  arrows: ArrowDefinition[],
  layout: Layout,
): ArrowDefinition[] {
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  return arrows.filter((arrow) =>
    arrow.cells.some((cell) => {
      const centre = cellCenter(cell, layout);
      return centre.x >= left && centre.x <= right && centre.y >= top && centre.y <= bottom;
    }),
  );
}

export function isFloorCell(grid: LevelGrid, row: number, col: number): boolean {
  return grid.matrix[row]?.[col] === CELL_FLOOR;
}

export function isBlockerCell(grid: LevelGrid, row: number, col: number): boolean {
  return grid.matrix[row]?.[col] === CELL_BLOCKER;
}
