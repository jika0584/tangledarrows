import { CELL_FLOOR, CELL_OUTSIDE, CellValue } from '../levels/types';

export const MIN_SHAPE_GRID = 24;
/** Largest single-level silhouette including the pass-through ring. */
export const MAX_SHAPE_GRID = 150;
/** Opening stages stay a bit smaller so they read as icons. */
export const MAX_OPENING_GRID = 40;

export interface Raster {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  data: ArrayLike<number>;
}

const PAPER = 232;
const COVERAGE = 0.42;
const MIN_FLOOR_CELLS = 40;

function pixel(raster: Raster, x: number, y: number): { r: number; g: number; b: number; a: number } {
  const i = (y * raster.width + x) * 4;
  return {
    r: raster.data[i] ?? 0,
    g: raster.data[i + 1] ?? 0,
    b: raster.data[i + 2] ?? 0,
    a: raster.data[i + 3] ?? 255,
  };
}

/** White, transparent, or pale gray paper. Coloured ink stays a silhouette. */
function isPaper(r: number, g: number, b: number, a: number): boolean {
  if (a < 24) return true;
  if (r >= PAPER && g >= PAPER && b >= PAPER) return true;
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  const sat = Math.max(r, g, b) - Math.min(r, g, b);
  return luma >= 200 && sat < 18;
}

function borderIsInk(raster: Raster): boolean {
  const { width, height } = raster;
  if (width < 2 || height < 2) return false;
  let ink = 0;
  let total = 0;
  const sample = (x: number, y: number) => {
    const p = pixel(raster, x, y);
    total += 1;
    if (!isPaper(p.r, p.g, p.b, p.a)) ink += 1;
  };
  for (let x = 0; x < width; x++) {
    sample(x, 0);
    sample(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    sample(0, y);
    sample(width - 1, y);
  }
  return total > 0 && ink / total > 0.55;
}

function inkTest(raster: Raster): (x: number, y: number) => boolean {
  const invert = borderIsInk(raster);
  return (x, y) => {
    if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return false;
    const p = pixel(raster, x, y);
    const paper = isPaper(p.r, p.g, p.b, p.a);
    return invert ? paper : !paper;
  };
}

function inkBounds(
  raster: Raster,
  isInk: (x: number, y: number) => boolean,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const { width, height } = raster;
  const visited = new Uint8Array(width * height);
  const minBlob = Math.max(32, Math.floor(width * height * 0.0003));
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  const idx = (x: number, y: number) => y * width + x;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = idx(x, y);
      if (visited[start] || !isInk(x, y)) continue;
      const stack = [{ x, y }];
      visited[start] = 1;
      let area = 0;
      let bMinX = x;
      let bMaxX = x;
      let bMinY = y;
      let bMaxY = y;
      while (stack.length > 0) {
        const cell = stack.pop()!;
        area += 1;
        if (cell.x < bMinX) bMinX = cell.x;
        if (cell.x > bMaxX) bMaxX = cell.x;
        if (cell.y < bMinY) bMinY = cell.y;
        if (cell.y > bMaxY) bMaxY = cell.y;
        for (const [dx, dy] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ] as const) {
          const nx = cell.x + dx;
          const ny = cell.y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const n = idx(nx, ny);
          if (visited[n] || !isInk(nx, ny)) continue;
          visited[n] = 1;
          stack.push({ x: nx, y: ny });
        }
      }
      if (area < minBlob) continue;
      if (bMinX < minX) minX = bMinX;
      if (bMinY < minY) minY = bMinY;
      if (bMaxX > maxX) maxX = bMaxX;
      if (bMaxY > maxY) maxY = bMaxY;
    }
  }

  if (maxX < 0) return null;
  return { minX, minY, maxX, maxY };
}

function dropSpecks(matrix: CellValue[][]): void {
  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 0;
  const seen: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (matrix[r][c] !== CELL_FLOOR || seen[r][c]) continue;
      const blob: Array<{ r: number; c: number }> = [];
      const stack = [{ r, c }];
      seen[r][c] = true;
      while (stack.length > 0) {
        const cell = stack.pop()!;
        blob.push(cell);
        for (const [dr, dc] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ] as const) {
          const nr = cell.r + dr;
          const nc = cell.c + dc;
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          if (seen[nr][nc] || matrix[nr][nc] !== CELL_FLOOR) continue;
          seen[nr][nc] = true;
          stack.push({ r: nr, c: nc });
        }
      }
      if (blob.length === 1) matrix[blob[0].r][blob[0].c] = CELL_OUTSIDE;
    }
  }
}

function floorBounds(matrix: CellValue[][]): {
  minR: number;
  minC: number;
  maxR: number;
  maxC: number;
} | null {
  let minR = matrix.length;
  let minC = matrix[0]?.length ?? 0;
  let maxR = -1;
  let maxC = -1;
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      if (matrix[r][c] !== CELL_FLOOR) continue;
      if (r < minR) minR = r;
      if (c < minC) minC = c;
      if (r > maxR) maxR = r;
      if (c > maxC) maxC = c;
    }
  }
  if (maxR < 0) return null;
  return { minR, minC, maxR, maxC };
}

/** Scale a floating silhouette up so it fills the chosen grid. */
function scaleFloorToGrid(matrix: CellValue[][], gridSize: number): CellValue[][] {
  const bounds = floorBounds(matrix);
  if (!bounds) return matrix;
  const height = bounds.maxR - bounds.minR + 1;
  const width = bounds.maxC - bounds.minC + 1;
  const srcSide = Math.max(height, width);
  if (srcSide >= Math.floor(gridSize * 0.88)) return matrix;

  const originR = bounds.minR - Math.floor((srcSide - height) / 2);
  const originC = bounds.minC - Math.floor((srcSide - width) / 2);
  const next: CellValue[][] = [];
  for (let row = 0; row < gridSize; row++) {
    const cells: CellValue[] = [];
    for (let col = 0; col < gridSize; col++) {
      const sr = originR + Math.floor((row / gridSize) * srcSide);
      const sc = originC + Math.floor((col / gridSize) * srcSide);
      const inside = sr >= 0 && sc >= 0 && sr < matrix.length && sc < matrix[sr].length;
      cells.push(inside && matrix[sr][sc] === CELL_FLOOR ? CELL_FLOOR : CELL_OUTSIDE);
    }
    next.push(cells);
  }
  return next;
}

/**
 * Picks a grid that keeps the cropped silhouette readable. Tiny drawings are
 * upscaled; huge ones are pixelated down so they still fit an opening board.
 */
export function gridSizeFromRaster(raster: Raster, maxGrid = MAX_OPENING_GRID): number {
  if (raster.width < 4 || raster.height < 4) {
    throw new Error('Image is too small. Use a square PNG of the silhouette.');
  }
  const isInk = inkTest(raster);
  const bounds = inkBounds(raster, isInk);
  if (!bounds) {
    throw new Error('No shape found. Draw a coloured silhouette on a white background.');
  }
  const side = Math.max(bounds.maxX - bounds.minX + 1, bounds.maxY - bounds.minY + 1);
  const guessed = Math.round(side / 6);
  return Math.min(maxGrid, Math.max(MIN_SHAPE_GRID, guessed));
}

/**
 * Turns a drawing into a board silhouette.
 *
 * Any colour on white becomes floor (black, green, blue, …). White, including
 * holes like a donut middle, stays pass-through outside. The drawing is cropped
 * to its bounding box so the shape fills the grid instead of floating in paper.
 */
export function matrixFromRaster(raster: Raster, gridSize: number): CellValue[][] {
  if (!Number.isInteger(gridSize) || gridSize < MIN_SHAPE_GRID || gridSize > MAX_SHAPE_GRID) {
    throw new Error(`Grid size must be ${MIN_SHAPE_GRID}–${MAX_SHAPE_GRID}.`);
  }
  if (raster.width < 4 || raster.height < 4) {
    throw new Error('Image is too small. Use a square PNG of the silhouette.');
  }

  const isInk = inkTest(raster);
  const bounds = inkBounds(raster, isInk);
  if (!bounds) {
    throw new Error('No shape found. Draw a coloured silhouette on a white background.');
  }

  const { minX, minY, maxX, maxY } = bounds;
  const pad = Math.max(1, Math.round(Math.max(maxX - minX + 1, maxY - minY + 1) * 0.02));
  const rawW = maxX - minX + 1;
  const rawH = maxY - minY + 1;
  const side = Math.max(rawW, rawH) + pad * 2;
  const originX = Math.round((minX + maxX + 1) / 2 - side / 2);
  const originY = Math.round((minY + maxY + 1) / 2 - side / 2);

  const matrix: CellValue[][] = [];
  for (let row = 0; row < gridSize; row++) {
    const cells: CellValue[] = [];
    for (let col = 0; col < gridSize; col++) {
      const x0 = originX + (col / gridSize) * side;
      const x1 = originX + ((col + 1) / gridSize) * side;
      const y0 = originY + (row / gridSize) * side;
      const y1 = originY + ((row + 1) / gridSize) * side;
      const ix0 = Math.floor(x0);
      const ix1 = Math.max(ix0 + 1, Math.ceil(x1));
      const iy0 = Math.floor(y0);
      const iy1 = Math.max(iy0 + 1, Math.ceil(y1));
      let ink = 0;
      let total = 0;
      for (let y = iy0; y < iy1; y++) {
        for (let x = ix0; x < ix1; x++) {
          total += 1;
          if (isInk(x, y)) ink += 1;
        }
      }
      cells.push(total > 0 && ink / total >= COVERAGE ? CELL_FLOOR : CELL_OUTSIDE);
    }
    matrix.push(cells);
  }

  dropSpecks(matrix);
  const fitted = scaleFloorToGrid(matrix, gridSize);

  const floor = fitted.flat().filter((cell) => cell === CELL_FLOOR).length;
  if (floor < MIN_FLOOR_CELLS) {
    throw new Error('That silhouette is too thin for a puzzle. Use a chunkier shape.');
  }

  return fitted;
}
