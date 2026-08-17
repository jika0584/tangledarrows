import {
  ALL_DIRECTIONS,
  ArrowDefinition,
  CELL_BLOCKER,
  CELL_FLOOR,
  CELL_OUTSIDE,
  CellValue,
  Difficulty,
  Direction,
  DIRECTION_DELTA,
  GridCell,
  Level,
  LevelGrid,
  formatSLevelId,
} from '../levels/types';
import { SeededRandom } from './SeededRandom';

export interface SLevelGeneratorOptions {
  /** 1-based S-level index (S1, S2, …). Also the default seed. */
  sLevelIndex: number;
  /** Override seed for testing / regeneration. */
  seed?: number;
  /** Interior playable size before boundary walls. Defaults to a size that scales with index. */
  gridSize?: number;
  /**
   * Fraction of floor cells that should end up covered by arrow bodies.
   * S-levels default high to keep difficulty at "Hard".
   */
  targetDensity?: number;
  /** Max polyline length per arrow (including head). */
  maxArrowLength?: number;
  /**
   * Optional custom board silhouette (1 = outside/wall, 0 = floor).
   * When supplied, `gridSize` is ignored and this matrix defines the board.
   */
  shapeMatrix?: CellValue[][];
}

interface OccupancyGrid {
  rows: number;
  cols: number;
  /** null = empty, string = id of the arrow occupying the cell */
  cells: (string | null)[][];
}

/** Interior board size bounds, per the dynamic 10x10 → 30x30 requirement. */
const MIN_INTERIOR = 10;
const MAX_INTERIOR = 30;

/** S-levels stay dense so the fallback tier remains genuinely hard. */
const DEFAULT_S_DENSITY = 0.42;

/**
 * Procedural S-level generator using reverse-solvable construction.
 *
 * Each arrow is only placed if its head currently has a clear ray to the board
 * edge. Because arrows are added one at a time, removing them in reverse
 * placement order is always a valid solution — the puzzle can never deadlock.
 * The generator records that order in `metadata.solutionOrder`.
 */
export class SLevelGenerator {
  generate(options: SLevelGeneratorOptions): Level {
    const { sLevelIndex } = options;
    const seed = options.seed ?? sLevelIndex;
    const rng = new SeededRandom(seed);

    const matrix = options.shapeMatrix
      ? options.shapeMatrix.map((row) => [...row])
      : this.createBorderedMatrix(this.resolveInteriorSize(sLevelIndex, options.gridSize));

    const rows = matrix.length;
    const cols = matrix[0].length;
    const occupancy = this.createOccupancy(rows, cols);

    const floorCells = this.countFloorCells(matrix);
    const density = options.targetDensity ?? DEFAULT_S_DENSITY;
    const targetOccupiedCells = Math.floor(floorCells * density);
    const maxLen = options.maxArrowLength ?? 5;

    const arrows: ArrowDefinition[] = [];
    let occupiedCells = 0;

    // Bounded so a saturated board can never spin forever.
    const maxAttempts = Math.max(200, floorCells * 12);
    let attempts = 0;

    while (occupiedCells < targetOccupiedCells && attempts < maxAttempts) {
      attempts++;
      const candidate = this.tryPlaceEscapableArrow(
        occupancy,
        matrix,
        arrows.length,
        maxLen,
        rng,
      );
      if (!candidate) continue;

      this.commitArrow(occupancy, candidate);
      arrows.push(candidate);
      occupiedCells += candidate.cells.length;
    }

    const grid: LevelGrid = { rows, cols, matrix };

    // Reverse placement order is a guaranteed-valid solve order.
    const solutionOrder = arrows.map((a) => a.id).reverse();

    return {
      id: formatSLevelId(sLevelIndex),
      source: 'procedural',
      version: 1,
      grid,
      arrows,
      metadata: {
        arrowCount: arrows.length,
        seed,
        difficulty: this.inferDifficulty(occupiedCells, floorCells),
        solutionOrder,
      },
    };
  }

  /** Board grows with progression, clamped to the 10–30 interior range. */
  private resolveInteriorSize(sLevelIndex: number, override?: number): number {
    const size = override ?? MIN_INTERIOR + Math.floor(sLevelIndex / 40);
    return Math.min(MAX_INTERIOR, Math.max(MIN_INTERIOR, size));
  }

  private createBorderedMatrix(interiorSize: number): CellValue[][] {
    const total = interiorSize + 2;
    const matrix: CellValue[][] = [];
    for (let r = 0; r < total; r++) {
      const row: CellValue[] = [];
      for (let c = 0; c < total; c++) {
        const isBorder = r === 0 || c === 0 || r === total - 1 || c === total - 1;
        row.push(isBorder ? CELL_OUTSIDE : CELL_FLOOR);
      }
      matrix.push(row);
    }
    return matrix;
  }

  private createOccupancy(rows: number, cols: number): OccupancyGrid {
    return {
      rows,
      cols,
      cells: Array.from({ length: rows }, () => Array<string | null>(cols).fill(null)),
    };
  }

  private countFloorCells(matrix: CellValue[][]): number {
    let count = 0;
    for (const row of matrix) {
      for (const cell of row) {
        if (cell === CELL_FLOOR) count++;
      }
    }
    return count;
  }

  /** Attempt one reverse-solvable placement: head must have a clear ray to the edge. */
  private tryPlaceEscapableArrow(
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    arrowIndex: number,
    maxLen: number,
    rng: SeededRandom,
  ): ArrowDefinition | null {
    for (const direction of rng.shuffle(ALL_DIRECTIONS)) {
      const headCandidates = this.findHeadCandidates(occupancy, matrix, direction);
      if (headCandidates.length === 0) continue;

      for (const head of rng.shuffle(headCandidates)) {
        const length = rng.nextInt(2, maxLen);
        const cells = this.buildPolyline(head, direction, length, occupancy, matrix, rng);
        if (!cells) continue;

        // A bent arrow sweeps several rows/columns at once, so every cell — not
        // just the head — must have a clear ray for the piece to be removable.
        const allCellsClear = cells.every((cell) =>
          this.hasClearRayToEdge(occupancy, matrix, cell.row, cell.col, DIRECTION_DELTA[direction]),
        );
        if (!allCellsClear) continue;

        return {
          id: `s${arrowIndex}-${head.row}x${head.col}`,
          cells,
          direction,
        };
      }
    }

    return null;
  }

  /**
   * Free cells whose forward ray reaches the board edge without crossing an
   * already-placed arrow.
   */
  private findHeadCandidates(
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    direction: Direction,
  ): GridCell[] {
    const delta = DIRECTION_DELTA[direction];
    const candidates: GridCell[] = [];

    for (let r = 0; r < occupancy.rows; r++) {
      for (let c = 0; c < occupancy.cols; c++) {
        if (matrix[r][c] !== CELL_FLOOR || occupancy.cells[r][c] !== null) continue;
        if (this.hasClearRayToEdge(occupancy, matrix, r, c, delta)) {
          candidates.push({ row: r, col: c });
        }
      }
    }

    return candidates;
  }

  /**
   * Walks the forward ray all the way off the board, mirroring runtime
   * collision: outside-silhouette cells are pass-through, while blockers and
   * already-placed arrows stop the escape.
   */
  private hasClearRayToEdge(
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    startRow: number,
    startCol: number,
    delta: GridCell,
  ): boolean {
    let r = startRow + delta.row;
    let c = startCol + delta.col;

    while (this.isInside(occupancy, r, c)) {
      if (matrix[r][c] === CELL_BLOCKER) return false;
      if (occupancy.cells[r][c] !== null) return false;
      r += delta.row;
      c += delta.col;
    }

    return true;
  }

  /**
   * Builds the polyline by walking backwards from the head. Steps are limited to
   * "away from head" and perpendicular, so the body can never intrude into the
   * head's forward escape ray.
   */
  private buildPolyline(
    head: GridCell,
    direction: Direction,
    length: number,
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    rng: SeededRandom,
  ): GridCell[] | null {
    const forward = DIRECTION_DELTA[direction];
    const back: GridCell = { row: -forward.row, col: -forward.col };
    const path: GridCell[] = [head];

    while (path.length < length) {
      const prev = path[path.length - 1];
      const steps = [back, ...this.perpendicular(back)];
      const options = steps
        .map((step) => ({ row: prev.row + step.row, col: prev.col + step.col }))
        .filter((cell) => this.canOccupy(occupancy, matrix, cell, path));

      if (options.length === 0) break;
      path.push(rng.pick(options));
    }

    if (path.length < 2) return null;

    path.reverse(); // store tail → head
    return path;
  }

  private canOccupy(
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    cell: GridCell,
    currentPath: GridCell[],
  ): boolean {
    if (!this.isInside(occupancy, cell.row, cell.col)) return false;
    if (matrix[cell.row][cell.col] !== CELL_FLOOR) return false;
    if (occupancy.cells[cell.row][cell.col] !== null) return false;
    return !currentPath.some((p) => p.row === cell.row && p.col === cell.col);
  }

  private perpendicular(delta: GridCell): GridCell[] {
    return delta.row !== 0
      ? [
          { row: 0, col: 1 },
          { row: 0, col: -1 },
        ]
      : [
          { row: 1, col: 0 },
          { row: -1, col: 0 },
        ];
  }

  private commitArrow(occupancy: OccupancyGrid, arrow: ArrowDefinition): void {
    for (const cell of arrow.cells) {
      occupancy.cells[cell.row][cell.col] = arrow.id;
    }
  }

  private isInside(grid: OccupancyGrid, row: number, col: number): boolean {
    return row >= 0 && col >= 0 && row < grid.rows && col < grid.cols;
  }

  private inferDifficulty(occupiedCells: number, floorCells: number): Difficulty {
    const density = floorCells === 0 ? 0 : occupiedCells / floorCells;
    if (density < 0.18) return 'easy';
    if (density < 0.32) return 'medium';
    return 'hard';
  }
}

/** Convenience factory for gameplay and tests. */
export function generateSLevel(sLevelIndex: number, seed?: number): Level {
  return new SLevelGenerator().generate({ sLevelIndex, seed });
}
