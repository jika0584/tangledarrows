import {
  CELL_FLOOR,
  CELL_OUTSIDE,
  CellValue,
  Difficulty,
  Level,
} from '../levels/types';
import { escapableArrowIds, isSolvable } from '../game/engine/WinCondition';
import { createBoardState } from '../game/engine/Movement';
import { SLevelGenerator, GenerationQuality } from './SLevelGenerator';

/** First numbered campaign board. */
export const FIRST_CURATED_LEVEL = 1;

/** Last numbered campaign board. Endless takes over after this. */
export const LAST_CURATED_LEVEL = 9999;

/** Visible campaign grids (interior plus the 1-cell pass-through ring). */
export const CAMPAIGN_STORED_SIZES = [39, 52, 64, 76, 91] as const;
export type CampaignStoredSize = (typeof CAMPAIGN_STORED_SIZES)[number];

/**
 * Single-level / image boards in PX historically offered these presets.
 * The studio Settings → Generator tab now owns the four size buttons.
 */
export const SINGLE_LEVEL_STORED_SIZES = [39, 52, 64, 76, 91, 150] as const;
export type SingleLevelStoredSize = (typeof SINGLE_LEVEL_STORED_SIZES)[number];

/** Inclusive stored-grid bounds (includes the 1-cell pass-through ring). */
export const MIN_STORED_BOARD_SIZE = 24;
export const MAX_STORED_BOARD_SIZE = 150;

export interface CuratedProfile {
  levelNumber: number;
  /** Playable interior (border ring is added around this). */
  interiorSize: number;
  targetDensity: number;
  maxArrowLength: number;
  maxTailLength: number;
  minArrows: number;
  difficulty: Difficulty;
  /** Easy boards keep more ready moves; later ones hunt for a tight opening. */
  prefer: 'open' | 'tight';
}

export interface GenerateCuratedOptions {
  /** Seeds to try. 1 is instant; 8 is the default quality/speed trade. */
  seedAttempts?: number;
  /** Skip the search and generate this seed only. */
  seed?: number;
  /** Visible grid including the pass-through ring. Overrides the campaign curve. */
  storedSize?: number;
  /** Packing aggressiveness / attempt budget inside each seed. */
  quality?: GenerationQuality;
}

const generator = new SLevelGenerator();

/**
 * Hard campaign only. Boards step 37 → 50 → 62 → 74 playable cells
 * (plus a 1-cell pass-through ring, so they store as 39 / 52 / 64 / 76).
 * PX also offers 91×91 (89 playable). Custom boards may use any stored size
 * from 24×24 through 150×150.
 */
export function profileForLevel(levelNumber: number): CuratedProfile {
  if (levelNumber < FIRST_CURATED_LEVEL || levelNumber > LAST_CURATED_LEVEL) {
    throw new RangeError(
      `Curated levels run ${FIRST_CURATED_LEVEL}–${LAST_CURATED_LEVEL}, got ${levelNumber}`,
    );
  }

  const span = LAST_CURATED_LEVEL - FIRST_CURATED_LEVEL;
  const t = Math.pow((levelNumber - FIRST_CURATED_LEVEL) / span, 0.55);
  const band = sizeBand(t);

  return {
    levelNumber,
    interiorSize: band.interiorSize,
    targetDensity: lerp(0.84, 0.9, t),
    maxArrowLength: band.maxArrowLength,
    maxTailLength: band.maxTailLength,
    minArrows: band.minArrows,
    difficulty: 'hard',
    prefer: 'tight',
  };
}

/** Builds one numbered campaign level, always solvable by construction. */
export function generateCuratedLevel(
  levelNumber: number,
  options: GenerateCuratedOptions = {},
): Level {
  const profile = tuneProfile(profileForLevel(levelNumber), options.storedSize);
  const matrix = borderedMatrix(profile.interiorSize);
  const attempts = Math.max(1, options.seedAttempts ?? 8);
  const quality = options.quality ?? 'normal';

  if (options.seed !== undefined) {
    return stamp(build(profile, matrix, options.seed, quality), profile, options.seed);
  }

  const candidates: { level: Level; seed: number }[] = [];
  for (let attempt = 0; attempt < attempts; attempt++) {
    const seed = seedFor(levelNumber, attempt);
    const level = build(profile, matrix, seed, quality);
    if (isSolvable(level) && level.arrows.length > 0) {
      candidates.push({ level, seed });
    }
  }

  if (candidates.length === 0) {
    const seed = seedFor(levelNumber, 0);
    return stamp(build(profile, matrix, seed, quality), profile, seed);
  }

  const picked = pickCandidate(candidates, profile.prefer);
  return stamp(picked.level, profile, picked.seed);
}

export function coveredCells(level: Level): number {
  return level.arrows.reduce((sum, arrow) => sum + arrow.cells.length, 0);
}

export function openingCount(level: Level): number {
  return escapableArrowIds(createBoardState(level)).length;
}

export function fillRatio(level: Level): number {
  const floor = level.grid.matrix.flat().filter((cell) => cell === CELL_FLOOR).length;
  return floor === 0 ? 0 : coveredCells(level) / floor;
}

export function asciiPreview(level: Level): string {
  const occupied = new Set(
    level.arrows.flatMap((arrow) => arrow.cells.map((cell) => `${cell.row},${cell.col}`)),
  );
  return level.grid.matrix
    .map((row, r) =>
      row
        .map((cell, c) =>
          cell === CELL_OUTSIDE ? ' ' : occupied.has(`${r},${c}`) ? '#' : '.',
        )
        .join(''),
    )
    .join('\n');
}

function build(
  profile: CuratedProfile,
  matrix: CellValue[][],
  seed: number,
  quality: GenerationQuality = 'normal',
): Level {
  return generator.generate({
    sLevelIndex: profile.levelNumber,
    seed,
    shapeMatrix: matrix,
    targetDensity: profile.targetDensity,
    maxArrowLength: profile.maxArrowLength,
    maxTailLength: profile.maxTailLength,
    minArrows: profile.minArrows,
    quality,
  });
}

function stamp(generated: Level, profile: CuratedProfile, seed: number): Level {
  return {
    ...generated,
    id: String(profile.levelNumber),
    source: 'curated',
    metadata: {
      ...generated.metadata,
      seed,
      difficulty: profile.difficulty,
      authoredAt: new Date().toISOString(),
      name: `Level ${profile.levelNumber}`,
      arrowCount: generated.arrows.length,
    },
  };
}

function pickCandidate(
  candidates: { level: Level; seed: number }[],
  prefer: 'open' | 'tight',
): { level: Level; seed: number } {
  const fullest = Math.max(...candidates.map((c) => coveredCells(c.level)));
  const contenders = candidates.filter((c) => coveredCells(c.level) >= fullest * 0.99);

  return contenders.reduce((best, current) => {
    const bestOpen = openingCount(best.level);
    const currentOpen = openingCount(current.level);
    if (prefer === 'open') return currentOpen > bestOpen ? current : best;
    return currentOpen < bestOpen ? current : best;
  });
}

function borderedMatrix(interiorSize: number): CellValue[][] {
  const total = interiorSize + 2;
  const matrix: CellValue[][] = [];
  for (let row = 0; row < total; row++) {
    const cells: CellValue[] = [];
    for (let col = 0; col < total; col++) {
      const border = row === 0 || col === 0 || row === total - 1 || col === total - 1;
      cells.push(border ? CELL_OUTSIDE : CELL_FLOOR);
    }
    matrix.push(cells);
  }
  return matrix;
}

/** Stored grid including the 1-cell pass-through ring. */
export function storedBoardSize(levelNumber: number): number {
  return profileForLevel(levelNumber).interiorSize + 2;
}

export function profileForBoard(levelNumber: number, storedSize: number): CuratedProfile {
  return tuneProfile(profileForLevel(levelNumber), storedSize);
}

export function rectangleMatrix(storedSize: number): CellValue[][] {
  if (!Number.isInteger(storedSize) || storedSize < MIN_STORED_BOARD_SIZE || storedSize > MAX_STORED_BOARD_SIZE) {
    throw new Error(`Board size must be ${MIN_STORED_BOARD_SIZE}–${MAX_STORED_BOARD_SIZE}.`);
  }
  return borderedMatrix(storedSize - 2);
}

function tuneProfile(profile: CuratedProfile, storedSize?: number): CuratedProfile {
  if (storedSize == null) return profile;
  const interiorSize = storedSize - 2;
  if (interiorSize === profile.interiorSize) return profile;
  if (
    storedSize < MIN_STORED_BOARD_SIZE ||
    storedSize > MAX_STORED_BOARD_SIZE ||
    !Number.isInteger(storedSize)
  ) {
    throw new RangeError(
      `Board size must be ${MIN_STORED_BOARD_SIZE}–${MAX_STORED_BOARD_SIZE}, got ${storedSize}.`,
    );
  }
  const scale = interiorSize / profile.interiorSize;
  return {
    ...profile,
    interiorSize,
    maxArrowLength: Math.max(8, Math.round(profile.maxArrowLength * scale)),
    maxTailLength: Math.max(16, Math.round(profile.maxTailLength * scale)),
    minArrows: Math.max(40, Math.round(profile.minArrows * scale * scale)),
  };
}

function sizeBand(t: number): {
  interiorSize: number;
  maxArrowLength: number;
  maxTailLength: number;
  minArrows: number;
} {
  if (t < 0.25) return { interiorSize: 37, maxArrowLength: 10, maxTailLength: 22, minArrows: 90 };
  if (t < 0.5) return { interiorSize: 50, maxArrowLength: 12, maxTailLength: 28, minArrows: 140 };
  if (t < 0.75) return { interiorSize: 62, maxArrowLength: 14, maxTailLength: 34, minArrows: 180 };
  return { interiorSize: 74, maxArrowLength: 16, maxTailLength: 40, minArrows: 220 };
}

function seedFor(levelNumber: number, attempt: number): number {
  return (levelNumber * 1_000_003 + attempt * 97) >>> 0;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}
