/**
 * Authors the bundled opening levels, each cut to a recognisable silhouette,
 * and writes them to src/levels/samples/.
 *
 * Run with: npm run gen:levels
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CELL_FLOOR, CELL_OUTSIDE, CellValue, Level } from '../src/levels/types';
import { escapableArrowIds, isSolvable } from '../src/game/engine/WinCondition';
import { createBoardState } from '../src/game/engine/Movement';
import { generateShapedLevel } from '../src/procedural/ShapedLevelGenerator';

type ShapeTest = (row: number, col: number, size: number) => boolean;

interface ShapeSpec {
  levelNumber: number;
  name: string;
  size: number;
  density: number;
  maxArrowLength: number;
  maxTailLength: number;
  difficulty: 'easy' | 'medium' | 'hard';
  test: ShapeTest;
}

/** Normalises a cell to the [-1, 1] square, sampled at its centre. */
function norm(index: number, size: number): number {
  return ((index + 0.5) / size) * 2 - 1;
}

/**
 * The classic implicit heart. Its lobes top out near y = 1.25 and the point
 * bottoms out at y = -1, so the row mapping is asymmetric to match and the
 * shape fills the grid instead of floating in it.
 */
const heart: ShapeTest = (row, col, size) => {
  const x = ((col + 0.5) / size) * 2.5 - 1.25;
  const y = 1.32 - ((row + 0.5) / size) * 2.42;
  const a = x * x + y * y - 1;
  return a * a * a - x * x * y * y * y <= 0;
};

/** A plain filled square — the whole grid is playable. */
const square: ShapeTest = () => true;

/** An annulus. The hole is pass-through, so arrows can escape straight across. */
const donut: ShapeTest = (row, col, size) => {
  const x = norm(col, size);
  const y = norm(row, size);
  const r = Math.hypot(x, y);
  return r <= 1 && r >= 0.42;
};

/** Isosceles triangle on a flat base; the grid gives the sides their steps. */
const triangle: ShapeTest = (row, col, size) => {
  const t = (row + 0.5) / size;
  const halfWidth = t * 0.98;
  return Math.abs(norm(col, size)) <= halfWidth;
};

// Same construction as endless: long reverse-built snakes, pocket puzzles, crumbs.
const SHAPES: ShapeSpec[] = [
  { levelNumber: 1, name: 'heart', size: 38, density: 0.82, maxArrowLength: 20, maxTailLength: 48, difficulty: 'medium', test: heart },
  { levelNumber: 2, name: 'square', size: 31, density: 0.82, maxArrowLength: 20, maxTailLength: 48, difficulty: 'easy', test: square },
  { levelNumber: 3, name: 'donut', size: 35, density: 0.82, maxArrowLength: 20, maxTailLength: 48, difficulty: 'medium', test: donut },
  { levelNumber: 4, name: 'triangle', size: 35, density: 0.82, maxArrowLength: 20, maxTailLength: 48, difficulty: 'hard', test: triangle },
];

function buildMatrix(spec: ShapeSpec): CellValue[][] {
  const matrix: CellValue[][] = [];
  for (let r = 0; r < spec.size; r++) {
    const row: CellValue[] = [];
    for (let c = 0; c < spec.size; c++) {
      row.push(spec.test(r, c, spec.size) ? CELL_FLOOR : CELL_OUTSIDE);
    }
    matrix.push(row);
  }
  return matrix;
}

const coveredCells = (level: Level): number =>
  level.arrows.reduce((sum, arrow) => sum + arrow.cells.length, 0);

/** Arrows the player could tap successfully on the very first move. */
const openings = (level: Level): number => escapableArrowIds(createBoardState(level)).length;

async function bestLevel(spec: ShapeSpec, matrix: CellValue[][]): Promise<Level> {
  return generateShapedLevel({
    levelNumber: spec.levelNumber,
    name: spec.name,
    difficulty: spec.difficulty,
    matrix,
    seedAttempts: 48,
    targetDensity: spec.density,
    maxArrowLength: spec.maxArrowLength,
    maxTailLength: spec.maxTailLength,
  });
}

function preview(matrix: CellValue[][], level: Level): string {
  const occupied = new Set(
    level.arrows.flatMap((a) => a.cells.map((c) => `${c.row},${c.col}`)),
  );
  return matrix
    .map((row, r) =>
      row
        .map((cell, c) =>
          cell === CELL_OUTSIDE ? ' ' : occupied.has(`${r},${c}`) ? '#' : '.',
        )
        .join(''),
    )
    .join('\n');
}

async function main(): Promise<void> {
  const samplesDir = join(dirname(fileURLToPath(import.meta.url)), '../src/levels/samples');

  for (const spec of SHAPES) {
    const matrix = buildMatrix(spec);
    const generated = await bestLevel(spec, matrix);

    const level: Level = {
      ...generated,
      id: String(spec.levelNumber),
      source: 'curated',
      metadata: {
        ...generated.metadata,
        difficulty: spec.difficulty,
        name: spec.name,
      },
    };

    const fileName = `level-${String(spec.levelNumber).padStart(3, '0')}.json`;
    writeFileSync(join(samplesDir, fileName), `${JSON.stringify(level, null, 2)}\n`, 'utf8');

    const floorCells = matrix.flat().filter((cell) => cell === CELL_FLOOR).length;
    console.log(`\n=== ${spec.name} (level ${spec.levelNumber}) ===`);
    console.log(preview(matrix, level));
    console.log(
      `floor: ${floorCells}  arrows: ${level.arrows.length}  ` +
        `fill: ${((coveredCells(level) / floorCells) * 100).toFixed(1)}%  ` +
        `openings: ${openings(level)}  ` +
        `solvable: ${isSolvable(level)}  -> ${fileName}`,
    );
  }
}

void main();
