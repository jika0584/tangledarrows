import { CELL_FLOOR, CELL_OUTSIDE, Direction, Level } from './types';

/** 7×7 playable board used to check the result overlay, hearts, and cheers. */
export const DEMO_ENDING_LEVEL_ID = 'demo-ending';

const O = CELL_OUTSIDE;
const F = CELL_FLOOR;
const PLAYABLE = 7;
const STORED = PLAYABLE + 2;

function ringMatrix(playable: number): number[][] {
  const n = playable + 2;
  return Array.from({ length: n }, (_, row) =>
    Array.from({ length: n }, (_, col) =>
      row === 0 || col === 0 || row === n - 1 || col === n - 1 ? O : F,
    ),
  );
}

/**
 * Lane jam: every odd row points left, every even row points right.
 * Only the rim arrow is free, so a wrong tap costs a heart.
 */
function laneArrows(): Level['arrows'] {
  const arrows: Level['arrows'] = [];
  for (let row = 1; row <= PLAYABLE; row++) {
    if (row % 2 === 1) {
      arrows.push(
        { id: `r${row}a`, cells: [{ row, col: 3 }, { row, col: 2 }, { row, col: 1 }], direction: 'left' as Direction },
        { id: `r${row}b`, cells: [{ row, col: 5 }, { row, col: 4 }], direction: 'left' as Direction },
        { id: `r${row}c`, cells: [{ row, col: 7 }, { row, col: 6 }], direction: 'left' as Direction },
      );
    } else {
      arrows.push(
        { id: `r${row}a`, cells: [{ row, col: 1 }, { row, col: 2 }], direction: 'right' as Direction },
        { id: `r${row}b`, cells: [{ row, col: 3 }, { row, col: 4 }], direction: 'right' as Direction },
        { id: `r${row}c`, cells: [{ row, col: 5 }, { row, col: 6 }, { row, col: 7 }], direction: 'right' as Direction },
      );
    }
  }
  return arrows;
}

const arrows = laneArrows();

export const DEMO_ENDING_LEVEL: Level = {
  id: DEMO_ENDING_LEVEL_ID,
  source: 'curated',
  version: 1,
  grid: {
    rows: STORED,
    cols: STORED,
    matrix: ringMatrix(PLAYABLE),
  },
  arrows,
  metadata: {
    arrowCount: arrows.length,
    name: 'Ending test',
    difficulty: 'easy',
  },
};
