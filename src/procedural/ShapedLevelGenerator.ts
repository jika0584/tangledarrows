import { CELL_FLOOR, CELL_OUTSIDE, CellValue, Difficulty, Level } from '../levels/types';
import { isSolvable } from '../game/engine/WinCondition';
import {
  coveredCells,
  LAST_CURATED_LEVEL,
  openingCount,
} from './CuratedGenerator';
import { SLevelGenerator, GenerationQuality } from './SLevelGenerator';
import { MAX_SHAPE_GRID } from './shapeFromImage';

export interface GenerateShapedOptions {
  levelNumber: number;
  name: string;
  difficulty: Difficulty;
  matrix: CellValue[][];
  seedAttempts?: number;
  targetDensity?: number;
  maxArrowLength?: number;
  maxTailLength?: number;
  minArrows?: number;
  quality?: GenerationQuality;
  onAttempt?: (info: {
    current: number;
    total: number;
    best: Level | null;
  }) => void | Promise<void>;
  /** Called between seed attempts; may throw to abort without picking a board. */
  checkCancel?: () => void;
}

const generator = new SLevelGenerator();

export function assertShapeMatrix(matrix: CellValue[][]): void {
  if (!Array.isArray(matrix) || matrix.length < 8) {
    throw new Error('Shape matrix is missing.');
  }
  const size = matrix.length;
  if (size > MAX_SHAPE_GRID) {
    throw new Error(`Shape grid is too large (max ${MAX_SHAPE_GRID}).`);
  }
  let floor = 0;
  for (const row of matrix) {
    if (!Array.isArray(row) || row.length !== size) {
      throw new Error('Shape must be a square grid.');
    }
    for (const cell of row) {
      if (cell !== CELL_FLOOR && cell !== CELL_OUTSIDE) {
        throw new Error('Shape cells must be floor or outside.');
      }
      if (cell === CELL_FLOOR) floor += 1;
    }
  }
  if (floor < 20) throw new Error('Not enough playable cells in that silhouette.');
}

/**
 * Packs arrows into a caller-supplied silhouette. Any campaign number can
 * use a shape; a rectangle is the default when no image is given.
 */
export async function generateShapedLevel(options: GenerateShapedOptions): Promise<Level> {
  const levelNumber = options.levelNumber;
  if (levelNumber < 1 || levelNumber > LAST_CURATED_LEVEL) {
    throw new Error(`Levels run 1–${LAST_CURATED_LEVEL}.`);
  }
  const name = options.name.trim() || `Level ${levelNumber}`;
  assertShapeMatrix(options.matrix);

  const attempts = Math.max(1, options.seedAttempts ?? 24);
  const candidates: { level: Level; seed: number }[] = [];
  let best: Level | null = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    options.checkCancel?.();
    const seed = attempt + 1;
    const level = generator.generate({
      sLevelIndex: levelNumber,
      seed,
      shapeMatrix: options.matrix,
      targetDensity: options.targetDensity ?? 0.82,
      maxArrowLength: options.maxArrowLength ?? 20,
      maxTailLength: options.maxTailLength ?? 48,
      minArrows: options.minArrows,
      quality: options.quality ?? 'normal',
    });
    if (isSolvable(level) && level.arrows.length > 0) {
      candidates.push({ level, seed });
      if (
        best === null ||
        coveredCells(level) > coveredCells(best) ||
        (coveredCells(level) === coveredCells(best) && openingCount(level) < openingCount(best))
      ) {
        best = level;
      }
    }
    await options.onAttempt?.({ current: attempt + 1, total: attempts, best });
    options.checkCancel?.();
  }

  if (candidates.length === 0) {
    throw new Error(
      `No solvable ${name} board from ${attempts} seed(s). Try a chunkier silhouette or higher quality.`,
    );
  }

  const fullest = Math.max(...candidates.map((candidate) => coveredCells(candidate.level)));
  const contenders = candidates.filter((candidate) => coveredCells(candidate.level) >= fullest * 0.99);
  const picked = contenders.reduce((lead, current) =>
    openingCount(current.level) < openingCount(lead.level) ? current : lead,
  );

  return {
    ...picked.level,
    id: String(levelNumber),
    source: 'curated',
    metadata: {
      ...picked.level.metadata,
      seed: picked.seed,
      difficulty: options.difficulty,
      authoredAt: new Date().toISOString(),
      name,
      arrowCount: picked.level.arrows.length,
    },
  };
}
