/**
 * Shortest-solve and regenerate-range helpers. Run with: npm run test:levels
 */
import { CELL_FLOOR, CELL_OUTSIDE, Level } from '../../../levels/types';
import { shortestSolution } from '../Solution';
import { parseLevelSpec } from '../../../../tools/px/levelSpec';

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

const O = CELL_OUTSIDE;
const F = CELL_FLOOR;

const tiny: Level = {
  id: '1',
  source: 'curated',
  version: 1,
  grid: {
    rows: 4,
    cols: 5,
    matrix: [
      [O, O, O, O, O],
      [O, F, F, F, O],
      [O, F, F, F, O],
      [O, O, O, O, O],
    ],
  },
  arrows: [
    { id: 'a', cells: [{ row: 1, col: 1 }, { row: 1, col: 2 }], direction: 'left' },
    { id: 'b', cells: [{ row: 1, col: 3 }, { row: 2, col: 3 }], direction: 'right' },
    { id: 'c', cells: [{ row: 2, col: 1 }, { row: 2, col: 2 }], direction: 'left' },
  ],
  metadata: { arrowCount: 3 },
};

check('shortestSolution clears a small board', () => {
  const order = shortestSolution(tiny);
  assert(!!order, 'expected a solution');
  assert(order!.length === 3, `expected 3 steps, got ${order!.length}`);
  assert(new Set(order).size === 3, 'solution repeated an arrow');
});

check('shortestSolution is deterministic for the same board', () => {
  const a = shortestSolution(tiny);
  const b = shortestSolution(tiny);
  assert(JSON.stringify(a) === JSON.stringify(b), 'solution order drifted between runs');
});

check('parseLevelSpec accepts 2-5 and 2 to 5', () => {
  assert(JSON.stringify(parseLevelSpec('2-5')) === JSON.stringify([2, 3, 4, 5]), 'dash range failed');
  assert(JSON.stringify(parseLevelSpec('2 to 5')) === JSON.stringify([2, 3, 4, 5]), 'to range failed');
  assert(JSON.stringify(parseLevelSpec('1,4,8-9')) === JSON.stringify([1, 4, 8, 9]), 'mixed list failed');
});

check('parseLevelSpec rejects empty and inverted nonsense', () => {
  let threw = false;
  try {
    parseLevelSpec('   ');
  } catch {
    threw = true;
  }
  assert(threw, 'blank spec should fail');
  assert(JSON.stringify(parseLevelSpec('5-2')) === JSON.stringify([2, 3, 4, 5]), 'reversed range should normalize');
});

if (failures > 0) {
  console.error(`\n${failures} solution/range check(s) failed`);
  process.exit(1);
}
console.log('\nAll solution/range checks passed.');
