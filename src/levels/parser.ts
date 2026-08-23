import {
  ALL_DIRECTIONS,
  ArrowDefinition,
  CELL_FLOOR,
  CellValue,
  DIRECTION_DELTA,
  Direction,
  Level,
  LevelGrid,
  LevelMetadata,
} from './types';

export class LevelParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LevelParseError';
  }
}

/**
 * Validates and parses raw JSON into a typed Level.
 * Throws LevelParseError on invalid data — call before gameplay or caching.
 */
export function parseLevel(raw: unknown): Level {
  if (!raw || typeof raw !== 'object') {
    throw new LevelParseError('Level must be a JSON object');
  }

  const data = raw as Record<string, unknown>;

  const id = requireString(data.id, 'id');
  const source = data.source === 'curated' || data.source === 'procedural'
    ? data.source
    : (() => { throw new LevelParseError('source must be "curated" or "procedural"'); })();

  const version = requireNumber(data.version, 'version');
  const grid = parseGrid(data.grid);
  const arrows = parseArrows(data.arrows, grid);
  const metadata = parseMetadata(data.metadata, arrows.length);

  validateArrowPlacement(arrows, grid);

  return { id, source, version, grid, arrows, metadata };
}

function parseGrid(raw: unknown): LevelGrid {
  if (!raw || typeof raw !== 'object') {
    throw new LevelParseError('grid must be an object');
  }
  const g = raw as Record<string, unknown>;
  const rows = requireNumber(g.rows, 'grid.rows');
  const cols = requireNumber(g.cols, 'grid.cols');
  const matrix = g.matrix;

  if (!Array.isArray(matrix) || matrix.length !== rows) {
    throw new LevelParseError(`grid.matrix must have ${rows} rows`);
  }

  const parsed: CellValue[][] = matrix.map((row, ri) => {
    if (!Array.isArray(row) || row.length !== cols) {
      throw new LevelParseError(`grid.matrix row ${ri} must have ${cols} columns`);
    }
    return row.map((cell, ci) => {
      if (cell !== 0 && cell !== 1 && cell !== 2) {
        throw new LevelParseError(`Invalid cell at [${ri}][${ci}]: ${cell}`);
      }
      return cell as CellValue;
    });
  });

  return { rows, cols, matrix: parsed };
}

function parseArrows(raw: unknown, grid: LevelGrid): ArrowDefinition[] {
  if (!Array.isArray(raw)) {
    throw new LevelParseError('arrows must be an array');
  }

  return raw.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new LevelParseError(`arrows[${index}] must be an object`);
    }
    const a = item as Record<string, unknown>;
    const id = requireString(a.id, `arrows[${index}].id`);
    const direction = a.direction as Direction;

    if (!ALL_DIRECTIONS.includes(direction)) {
      throw new LevelParseError(`arrows[${index}].direction invalid: ${direction}`);
    }

    if (!Array.isArray(a.cells) || a.cells.length < 2) {
      throw new LevelParseError(`arrows[${index}].cells must have at least 2 points`);
    }

    const cells = a.cells.map((c, ci) => {
      if (!c || typeof c !== 'object') {
        throw new LevelParseError(`arrows[${index}].cells[${ci}] invalid`);
      }
      const cell = c as Record<string, unknown>;
      const row = requireNumber(cell.row, `arrows[${index}].cells[${ci}].row`);
      const col = requireNumber(cell.col, `arrows[${index}].cells[${ci}].col`);
      if (row < 0 || row >= grid.rows || col < 0 || col >= grid.cols) {
        throw new LevelParseError(`Arrow ${id} cell out of bounds: [${row},${col}]`);
      }
      if (grid.matrix[row][col] !== CELL_FLOOR) {
        throw new LevelParseError(`Arrow ${id} must rest on floor, got [${row},${col}]`);
      }
      return { row, col };
    });

    // The arrowhead is drawn along the segment feeding into it, so that segment
    // has to run in the escape direction or the head would point off-axis.
    const neck = cells[cells.length - 2];
    const tip = cells[cells.length - 1];
    const delta = DIRECTION_DELTA[direction];
    if (tip.row - neck.row !== delta.row || tip.col - neck.col !== delta.col) {
      throw new LevelParseError(
        `Arrow ${id} head does not sit on a neck pointing ${direction}`,
      );
    }

    return {
      id,
      cells,
      direction,
      role: a.role === 'crumb' ? 'crumb' : a.role === 'filler' ? 'filler' : undefined,
    };
  });
}

function parseMetadata(raw: unknown, arrowCount: number): LevelMetadata {
  const base: LevelMetadata = { arrowCount };
  if (!raw || typeof raw !== 'object') return base;
  const m = raw as Record<string, unknown>;
  return {
    ...base,
    name: typeof m.name === 'string' ? m.name : undefined,
    seed: typeof m.seed === 'number' ? m.seed : undefined,
    difficulty:
      m.difficulty === 'easy' || m.difficulty === 'medium' || m.difficulty === 'hard'
        ? m.difficulty
        : undefined,
    authoredAt: typeof m.authoredAt === 'string' ? m.authoredAt : undefined,
    solutionOrder: Array.isArray(m.solutionOrder)
      ? m.solutionOrder.filter((id): id is string => typeof id === 'string')
      : undefined,
    shapeSource: typeof m.shapeSource === 'string' && m.shapeSource.length > 0 ? m.shapeSource : undefined,
  };
}

function validateArrowPlacement(arrows: ArrowDefinition[], grid: LevelGrid): void {
  const occupied = new Map<string, string>();

  for (const arrow of arrows) {
    for (let i = 0; i < arrow.cells.length; i++) {
      const { row, col } = arrow.cells[i];
      const key = `${row},${col}`;

      if (occupied.has(key)) {
        throw new LevelParseError(
          `Cell [${row},${col}] occupied by both ${occupied.get(key)} and ${arrow.id}`,
        );
      }
      occupied.set(key, arrow.id);

      if (i > 0) {
        const prev = arrow.cells[i - 1];
        const dr = Math.abs(prev.row - row);
        const dc = Math.abs(prev.col - col);
        if (dr + dc !== 1) {
          throw new LevelParseError(`Arrow ${arrow.id} has non-adjacent cells`);
        }
      }
    }
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new LevelParseError(`${field} must be a non-empty string`);
  }
  return value;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new LevelParseError(`${field} must be a finite number`);
  }
  return value;
}
