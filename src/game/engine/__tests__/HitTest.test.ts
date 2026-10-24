/**
 * Tap targeting. Run with: npx tsx src/game/engine/__tests__/HitTest.test.ts
 */
import { ArrowDefinition, CELL_FLOOR, LevelGrid } from '../../../levels/types';
import { BoardLayout } from '../../rendering/ArrowPath';
import { findTappedArrow } from '../HitTest';

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

const CELL = 20;

const layout: BoardLayout = {
  cellSize: CELL,
  originX: 0,
  originY: 0,
};

function point(col: number, row: number, dx = 0.5, dy = 0.5): { x: number; y: number } {
  return { x: (col + dx) * CELL, y: (row + dy) * CELL };
}

function openGrid(rows: number, cols: number): LevelGrid {
  return {
    rows,
    cols,
    matrix: Array.from({ length: rows }, () => Array.from({ length: cols }, () => CELL_FLOOR)),
  };
}

const free: ArrowDefinition = {
  id: 'free',
  direction: 'right',
  cells: [
    { row: 0, col: 0 },
    { row: 0, col: 1 },
    { row: 0, col: 2 },
  ],
};

const blocked: ArrowDefinition = {
  id: 'blocked',
  direction: 'up',
  cells: [
    { row: 2, col: 4 },
    { row: 2, col: 3 },
    { row: 2, col: 2 },
  ],
};

const neighbour: ArrowDefinition = {
  id: 'neighbour',
  direction: 'down',
  cells: [
    { row: 0, col: 4 },
    { row: 1, col: 4 },
    { row: 2, col: 4 },
  ],
};

const grid = openGrid(5, 6);
const arrows = [free, blocked];

check('tap on a head cell selects that arrow', () => {
  const { x, y } = point(2, 0);
  const hit = findTappedArrow(x, y, arrows, layout, 1, grid);
  assert(hit?.id === 'free', `expected free, got ${hit?.id}`);
});

check('tap just past the head tip still selects that head', () => {
  // Visual tip of a right-facing head sits near the outward edge of col 2.
  const { x, y } = point(2, 0, 1.15, 0.5);
  const hit = findTappedArrow(x, y, arrows, layout, 1, grid);
  assert(hit?.id === 'free', `expected free, got ${hit?.id}`);
});

check('tap on a blocked body selects that arrow, not a distant free head', () => {
  const { x, y } = point(4, 2);
  const hit = findTappedArrow(x, y, arrows, layout, 1, grid);
  assert(hit?.id === 'blocked', `expected blocked, got ${hit?.id}`);
});

check('a distant free head does not win when zoomed far out', () => {
  // Old code divided the touch target by zoom with no cap, so a free head
  // several cells away would steal this tap at MIN_ZOOM.
  const { x, y } = point(4, 2);
  const hit = findTappedArrow(x, y, arrows, layout, 0.22, grid);
  assert(hit?.id === 'blocked', `expected blocked, got ${hit?.id}`);
});

check('a tap just past the tip on empty space still selects that head', () => {
  const { x, y } = point(2, 0, 1.18, 0.5);
  const hit = findTappedArrow(x, y, arrows, layout, 1, grid);
  assert(hit?.id === 'free', `expected free, got ${hit?.id}`);
});

check('a tap well into the next empty cell is a miss', () => {
  const { x, y } = point(3, 0, 0.4, 0.5);
  const hit = findTappedArrow(x, y, arrows, layout, 1, grid);
  assert(hit == null, `expected miss, got ${hit?.id}`);
});

check('tap on a neighbour body does not jump to a nearby free head', () => {
  const packed = [free, neighbour];
  const { x, y } = point(4, 0);
  const hit = findTappedArrow(x, y, packed, layout, 1, grid);
  assert(hit?.id === 'neighbour', `expected neighbour, got ${hit?.id}`);
});

check('a tap that grazes a neighbour head still fires that head', () => {
  const packed = [free, neighbour];
  // Just above the down-facing tip of neighbour (head at 2,4).
  const { x, y } = point(4, 2, 0.5, 1.1);
  const hit = findTappedArrow(x, y, packed, layout, 1, grid);
  assert(hit?.id === 'neighbour', `expected neighbour, got ${hit?.id}`);
});

check('a tap a full cell away from a head is a miss, not a magnet', () => {
  const { x, y } = point(4, 0);
  const hit = findTappedArrow(x, y, [free], layout, 1, grid);
  assert(hit == null, `expected miss, got ${hit?.id}`);
});

check('big head padding reaches a nearby empty cell that small does not', () => {
  const { x, y } = point(3, 0, 0.4, 0.5);
  const tight = findTappedArrow(x, y, arrows, layout, 1, grid, {
    headPadding: 'small',
    tailPadding: 'none',
  });
  const loose = findTappedArrow(x, y, arrows, layout, 1, grid, {
    headPadding: 'big',
    tailPadding: 'none',
  });
  assert(tight == null, `expected small padding to miss, got ${tight?.id}`);
  assert(loose?.id === 'free', `expected big padding to hit free, got ${loose?.id}`);
});

check('empty space far from every arrow is a miss', () => {
  const { x, y } = point(5, 4);
  const hit = findTappedArrow(x, y, arrows, layout, 1, grid);
  assert(hit == null, `expected miss, got ${hit?.id}`);
});

if (failures > 0) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nHitTest ok');
