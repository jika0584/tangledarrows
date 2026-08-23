/**
 * PX arrow edit helpers. Run with: npm run test:levels
 */
import { ArrowDefinition, CELL_FLOOR, CELL_OUTSIDE, Level } from '../../levels/types';
import { parseLevel } from '../../levels/parser';
import {
  canMerge,
  canSeparate,
  deleteArrows,
  mergeArrows,
  separateArrows,
  turnCellIndices,
} from '../../../tools/px-ui/src/editArrows';

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

function cell(row: number, col: number) {
  return { row, col };
}

function arrow(id: string, cells: Array<[number, number]>, direction: ArrowDefinition['direction']): ArrowDefinition {
  return { id, direction, cells: cells.map(([row, col]) => ({ row, col })) };
}

function board(arrows: ArrowDefinition[], size = 12): Level {
  const matrix = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) =>
      row === 0 || col === 0 || row === size - 1 || col === size - 1 ? CELL_OUTSIDE : CELL_FLOOR,
    ),
  );
  return {
    id: '1',
    source: 'curated',
    version: 1,
    grid: { rows: size, cols: size, matrix },
    arrows,
    metadata: { arrowCount: arrows.length },
  };
}

check('one turn splits into two arrows at that turn', () => {
  const level = board([
    arrow('a', [
      [1, 1],
      [1, 2],
      [1, 3],
      [1, 4],
      [2, 4],
      [3, 4],
    ], 'down'),
  ]);
  assert(turnCellIndices(level.arrows[0].cells).length === 1, 'expected one turn');
  const { level: next, selectedIds } = separateArrows(level, new Set(['a']));
  assert(next.arrows.length === 2, `expected 2 arrows, got ${next.arrows.length}`);
  assert(selectedIds.length === 2, 'both pieces should stay selected');
  assert(next.arrows.every((piece) => piece.cells.length >= 2), 'pieces too short');
  assert(
    next.arrows[0].cells.length + next.arrows[1].cells.length === 6,
    'cells were lost or duplicated',
  );
  parseLevel(next);
});

check('three turns cut at the middle turn into two arrows', () => {
  const level = board([
    arrow('b', [
      [1, 1],
      [1, 2],
      [1, 3],
      [2, 3],
      [3, 3],
      [3, 4],
      [3, 5],
      [4, 5],
      [5, 5],
    ], 'down'),
  ]);
  assert(turnCellIndices(level.arrows[0].cells).length === 3, 'expected three turns');
  const { level: next } = separateArrows(level, new Set(['b']));
  assert(next.arrows.length === 2, `expected 2 arrows, got ${next.arrows.length}`);
  parseLevel(next);
});

check('four turns become three arrows', () => {
  const level = board([
    arrow('c', [
      [1, 1],
      [1, 2],
      [1, 3],
      [2, 3],
      [3, 3],
      [3, 2],
      [3, 1],
      [4, 1],
      [5, 1],
      [5, 2],
    ], 'right'),
  ]);
  assert(turnCellIndices(level.arrows[0].cells).length === 4, 'expected four turns');
  assert(canSeparate(level, new Set(['c'])), 'four-turn arrow should separate');
  const { level: next } = separateArrows(level, new Set(['c']));
  assert(next.arrows.length === 3, `expected 3 arrows, got ${next.arrows.length}`);
  parseLevel(next);
});

check('adjacent arrows merge into one polyline', () => {
  const a = arrow('m1', [[1, 1], [1, 2], [1, 3]], 'right');
  const b = arrow('m2', [[1, 4], [1, 5], [1, 6]], 'right');
  const level = board([a, b]);
  assert(canMerge(level, new Set(['m1', 'm2'])), 'head-to-tail should merge');
  const { level: next } = mergeArrows(level, new Set(['m1', 'm2']));
  assert(next.arrows.length === 1, `expected 1 arrow, got ${next.arrows.length}`);
  assert(next.arrows[0].cells.length === 6, 'merged length mismatch');
  assert(next.arrows[0].direction === 'right', 'merged direction should follow the last segment');
  parseLevel(next);
});

check('delete removes only the selected arrows', () => {
  const level = board([
    arrow('keep', [[2, 1], [2, 2]], 'right'),
    arrow('drop', [[3, 1], [3, 2]], 'right'),
  ]);
  const next = deleteArrows(level, new Set(['drop']));
  assert(next.arrows.length === 1 && next.arrows[0].id === 'keep', 'wrong arrows after delete');
  assert(next.metadata.arrowCount === 1, 'arrowCount not stamped');
});

if (failures > 0) {
  console.error(`\n${failures} editArrows test(s) failed`);
  process.exit(1);
}
console.log('\neditArrows tests passed');
