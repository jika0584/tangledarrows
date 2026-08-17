/**
 * Sanity checks for level generation and collision.
 * Run with: npm run test:levels
 */
import sampleCuratedLevel from '../../levels/samples/level-001.json';
import { generateSLevel, SLevelGenerator } from '../SLevelGenerator';
import { parseLevel } from '../../levels/parser';
import { isSolvable } from '../../game/engine/WinCondition';
import { OccupancyIndex } from '../../game/engine/Grid';
import { resolveSlide } from '../../game/engine/Collision';
import { CELL_FLOOR, CELL_OUTSIDE, CellValue } from '../../levels/types';

let failures = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failures++;
    console.error(`  FAIL  ${name}: ${(error as Error).message}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

check('same seed produces identical levels', () => {
  const a = generateSLevel(1, 42);
  const b = generateSLevel(1, 42);
  assert(JSON.stringify(a) === JSON.stringify(b), 'levels differ for identical seed');
});

check('generated levels pass schema validation', () => {
  for (const index of [1, 5, 40, 120, 400]) {
    const level = generateSLevel(index);
    const parsed = parseLevel(level);
    assert(parsed.id === `S${index}`, `expected id S${index}, got ${parsed.id}`);
    assert(
      parsed.metadata.arrowCount === parsed.arrows.length,
      'arrowCount does not match arrows array',
    );
  }
});

check('every generated level is fully solvable', () => {
  for (let index = 1; index <= 60; index++) {
    const level = generateSLevel(index);
    assert(level.arrows.length > 0, `S${index} generated no arrows`);
    assert(isSolvable(level), `S${index} is not solvable`);
  }
});

check('recorded solutionOrder actually clears the board', () => {
  const level = generateSLevel(23);
  const order = level.metadata.solutionOrder ?? [];
  assert(order.length === level.arrows.length, 'solutionOrder length mismatch');

  let remaining = [...level.arrows];
  for (const id of order) {
    const arrow = remaining.find((a) => a.id === id);
    assert(!!arrow, `solutionOrder references unknown arrow ${id}`);
    const outcome = resolveSlide(arrow!, level.grid, new OccupancyIndex(remaining));
    assert(outcome.outcome === 'escaped', `arrow ${id} was blocked following solutionOrder`);
    remaining = remaining.filter((a) => a.id !== id);
  }
  assert(remaining.length === 0, 'board not cleared by solutionOrder');
});

check('grid sizes stay within the 10x10 to 30x30 range', () => {
  for (const index of [1, 200, 900, 5000]) {
    const level = generateSLevel(index);
    const interior = level.grid.rows - 2;
    assert(interior >= 10 && interior <= 30, `interior ${interior} out of range at S${index}`);
    assert(level.grid.rows === level.grid.matrix.length, 'row count mismatch');
    assert(level.grid.cols === level.grid.matrix[0].length, 'col count mismatch');
  }
});

check('S-levels stay dense enough to read as hard', () => {
  for (const index of [10, 50, 300]) {
    const level = generateSLevel(index);
    assert(
      level.metadata.difficulty === 'hard',
      `S${index} difficulty was ${level.metadata.difficulty}`,
    );
  }
});

check('blocked slides are detected', () => {
  const level = generateSLevel(7);
  const occupancy = new OccupancyIndex(level.arrows);
  const results = level.arrows.map((a) => resolveSlide(a, level.grid, occupancy));
  assert(
    results.some((r) => r.outcome === 'blocked'),
    'a dense level should contain at least one blocked arrow',
  );
  assert(
    results.some((r) => r.outcome === 'escaped'),
    'at least one arrow must always be escapable',
  );
});

check('custom board silhouettes are respected', () => {
  const size = 12;
  const shape: CellValue[][] = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => {
      const insideCircle = (r - 6) ** 2 + (c - 6) ** 2 <= 16;
      return insideCircle ? CELL_FLOOR : CELL_OUTSIDE;
    }),
  );

  const level = new SLevelGenerator().generate({ sLevelIndex: 1, shapeMatrix: shape });
  assert(level.arrows.length > 0, 'no arrows placed inside silhouette');
  assert(isSolvable(level), 'shaped level is not solvable');

  for (const arrow of level.arrows) {
    for (const cell of arrow.cells) {
      assert(
        shape[cell.row][cell.col] === CELL_FLOOR,
        `arrow ${arrow.id} placed outside silhouette at ${cell.row},${cell.col}`,
      );
    }
  }
});

check('sample curated level parses and is solvable', () => {
  const level = parseLevel(sampleCuratedLevel);
  assert(level.source === 'curated', 'sample should be a curated level');
  assert(isSolvable(level), 'sample level is not solvable');
});

check('parser rejects overlapping arrows', () => {
  const bad = {
    id: '99',
    source: 'curated',
    version: 1,
    grid: {
      rows: 3,
      cols: 3,
      matrix: [
        [1, 1, 1],
        [1, 0, 1],
        [1, 1, 1],
      ],
    },
    arrows: [
      { id: 'x', cells: [{ row: 1, col: 1 }, { row: 1, col: 1 }], direction: 'right' },
    ],
    metadata: { arrowCount: 1 },
  };

  let threw = false;
  try {
    parseLevel(bad);
  } catch {
    threw = true;
  }
  assert(threw, 'parser accepted an arrow with duplicated cells');
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll level checks passed');
