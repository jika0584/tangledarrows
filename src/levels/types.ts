/**
 * Core level data types for Amaze Escape.
 *
 * Curated levels (1–9999) and procedural S-levels share this schema.
 * The `matrix` defines the board shape/boundary; `arrows` define puzzle pieces.
 * Collision at runtime is resolved against other *active* arrows, not the matrix
 * alone — see src/game/engine/Collision.ts.
 */

/**
 * Board cell semantics.
 *
 * 0 — floor. Arrows may rest here.
 * 1 — outside the board silhouette. Arrows may *slide through* it on their way
 *     off the board, but never start there. This is what gives a level its
 *     shape (e.g. the key outline) without walling arrows in.
 * 2 — solid blocker. Stops a sliding arrow like another arrow would.
 */
export type CellValue = 0 | 1 | 2;

export const CELL_FLOOR = 0 satisfies CellValue;
export const CELL_OUTSIDE = 1 satisfies CellValue;
export const CELL_BLOCKER = 2 satisfies CellValue;

/** Cardinal direction the arrow head points (slide direction on tap). */
export type Direction = 'up' | 'down' | 'left' | 'right';

export interface GridCell {
  row: number;
  col: number;
}

/**
 * One arrow piece: polyline from tail → head (last cell is the head).
 * All cells are 4-adjacent; 90° turns are allowed.
 */
export interface ArrowDefinition {
  id: string;
  /** Ordered path; final element is the tappable head. */
  cells: GridCell[];
  direction: Direction;
}

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface LevelMetadata {
  arrowCount: number;
  /** Present on S-levels for reproducibility. */
  seed?: number;
  difficulty?: Difficulty;
  /** ISO date when a curated level was authored. */
  authoredAt?: string;
  /**
   * Known-good solve order (arrow ids, first to last).
   * Emitted by the procedural generator; optional for curated levels.
   */
  solutionOrder?: string[];
}

export interface LevelGrid {
  rows: number;
  cols: number;
  /** 2D matrix [row][col]; see CellValue for cell semantics. */
  matrix: CellValue[][];
}

export type LevelSource = 'curated' | 'procedural';

/** Canonical level document — stored locally as JSON and synced from Supabase. */
export interface Level {
  /** "42" for curated, "S17" for procedural fallback. */
  id: string;
  source: LevelSource;
  version: number;
  grid: LevelGrid;
  arrows: ArrowDefinition[];
  metadata: LevelMetadata;
}

/** Batch manifest returned by Supabase for curated level downloads. */
export interface LevelBatchManifest {
  batchId: string;
  startLevel: number;
  endLevel: number;
  levelCount: number;
  checksum?: string;
}

/** Lives shown as hearts in the HUD. No score, no IQ metric. */
export const MAX_LIVES = 3;

/** Direction → delta row/col */
export const DIRECTION_DELTA: Record<Direction, GridCell> = {
  up: { row: -1, col: 0 },
  down: { row: 1, col: 0 },
  left: { row: 0, col: -1 },
  right: { row: 0, col: 1 },
};

export const ALL_DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];

/** The tappable head is the last cell of the polyline. */
export function arrowHead(arrow: ArrowDefinition): GridCell {
  return arrow.cells[arrow.cells.length - 1];
}

/** Parse a level id into its tier and numeric index. */
export function parseLevelId(id: string): { type: LevelSource; index: number } {
  if (id.startsWith('S') || id.startsWith('s')) {
    return { type: 'procedural', index: parseInt(id.slice(1), 10) };
  }
  return { type: 'curated', index: parseInt(id, 10) };
}

/** Format a procedural level id from a 1-based index. */
export function formatSLevelId(index: number): string {
  return `S${index}`;
}

export function cellKey(cell: GridCell): string {
  return `${cell.row},${cell.col}`;
}
