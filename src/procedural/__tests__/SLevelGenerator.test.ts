/**
 * Sanity checks for level generation and collision.
 * Run with: npm run test:levels
 */
import { generateSLevel, fillLevelVacancies, SLevelGenerator } from '../SLevelGenerator';
import { parseLevel } from '../../levels/parser';
import { escapableArrowIds, isSolvable } from '../../game/engine/WinCondition';
import { OccupancyIndex } from '../../game/engine/Grid';
import { resolveSlide } from '../../game/engine/Collision';
import { applyTap, createBoardState } from '../../game/engine/Movement';
import { CELL_FLOOR, CELL_OUTSIDE, CellValue, DIRECTION_DELTA, MAX_LIVES } from '../../levels/types';
import { DEMO_ENDING_LEVEL } from '../../levels/demoEnding';

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

check('a random salt produces a different layout for the same S-number', () => {
  const a = generateSLevel(5, undefined, { randomSalt: 1 });
  const b = generateSLevel(5, undefined, { randomSalt: 2 });
  const again = generateSLevel(5, undefined, { randomSalt: 1 });
  assert(JSON.stringify(a) !== JSON.stringify(b), 'random salts produced the same maze');
  assert(JSON.stringify(a) === JSON.stringify(again), 'same salt did not replay');
  assert(a.metadata.seed !== b.metadata.seed, 'salted seeds were not mixed');
});

check('core heads cover several quadrants while staying in their macro blocks', () => {
  const level = generateSLevel(8);
  const core = level.arrows.filter((arrow) => !arrow.role);
  const rows = level.grid.rows;
  const cols = level.grid.cols;
  const zoneOf = (arrow: (typeof core)[number]): number => {
    const head = arrow.cells[arrow.cells.length - 1];
    const rowBand = Math.min(1, Math.floor((head.row * 2) / rows));
    const colBand = Math.min(1, Math.floor((head.col * 2) / cols));
    return rowBand * 2 + colBand;
  };
  const zones = core.slice(0, Math.min(20, core.length)).map(zoneOf);
  const unique = new Set(zones);
  assert(unique.size >= 3, `S8 only used ${unique.size} of 4 quadrants for the first heads`);
});

check('core reverse-construction still owns most of the puzzle', () => {
  for (const index of [1, 12, 40]) {
    const level = generateSLevel(index);
    const coreCells = level.arrows
      .filter((arrow) => !arrow.role)
      .reduce((sum, arrow) => sum + arrow.cells.length, 0);
    const allCells = level.arrows.reduce((sum, arrow) => sum + arrow.cells.length, 0);
    assert(allCells > 0, `S${index} generated an empty board`);
    assert(
      coreCells / allCells >= 0.4,
      `S${index} core only covered ${(coreCells / allCells * 100).toFixed(0)}% of arrow cells (pink took over)`,
    );
  }
});

check('gap fillers mix escape directions instead of flocking one way', () => {
  for (const index of [12, 40]) {
    const level = generateSLevel(index);
    const fillers = level.arrows.filter((arrow) => arrow.role === 'filler');
    if (fillers.length < 8) continue;
    const counts = { up: 0, down: 0, left: 0, right: 0 };
    for (const arrow of fillers) counts[arrow.direction] += 1;
    const maxShare = Math.max(...Object.values(counts)) / fillers.length;
    assert(
      maxShare <= 0.6,
      `S${index} fillers were ${(maxShare * 100).toFixed(0)}% one direction (${JSON.stringify(counts)})`,
    );
  }
});

check('pink fillers stay a minority of the board and rarely open free clicks', () => {
  for (const index of [12, 40]) {
    const level = generateSLevel(index);
    const floor = level.grid.matrix.flat().filter((cell) => cell === CELL_FLOOR).length;
    const pinkCells = level.arrows
      .filter((arrow) => arrow.role === 'filler')
      .reduce((sum, arrow) => sum + arrow.cells.length, 0);
    const coreCells = level.arrows
      .filter((arrow) => !arrow.role)
      .reduce((sum, arrow) => sum + arrow.cells.length, 0);
    const crumbCells = level.arrows
      .filter((arrow) => arrow.role === 'crumb')
      .reduce((sum, arrow) => sum + arrow.cells.length, 0);
    assert(floor > 0, `S${index} has no floor`);
    assert(
      pinkCells <= coreCells * 1.15,
      `S${index} pink cells (${pinkCells}) outgrew core (${coreCells})`,
    );
    assert(
      crumbCells === 0,
      `S${index} still had ${crumbCells} purple crumb cells`,
    );
    const open = new Set(escapableArrowIds(createBoardState(level)));
    const pinkOpen = level.arrows.filter((arrow) => arrow.role === 'filler' && open.has(arrow.id)).length;
    assert(
      pinkOpen <= 1,
      `S${index} opened with ${pinkOpen} free pink fillers`,
    );
  }
});

check('core generation round-robins 1-5 arrow micro-clusters across macro blocks', () => {
  const level = generateSLevel(12);
  const core = level.arrows.filter((arrow) => !arrow.role);
  const ids = core.map((arrow) => arrow.blockId).filter((id): id is number => typeof id === 'number');
  assert(ids.length === core.length, 'core arrows are missing blockId');
  assert(new Set(ids).size >= 2, `S12 only used ${new Set(ids).size} macro block(s)`);
  const prefix = ids.slice(0, Math.min(30, ids.length));
  let run = 1;
  let maxRun = 1;
  for (let i = 1; i < prefix.length; i++) {
    if (prefix[i] === prefix[i - 1]) {
      run += 1;
      if (run > maxRun) maxRun = run;
    } else {
      run = 1;
    }
  }
  assert(maxRun <= 5, `S12 placed ${maxRun} consecutive core heads in the same macro block`);
  assert(
    core.every((arrow) => typeof arrow.solveIndex === 'number' && arrow.solveIndex >= 1),
    'core arrows are missing solveIndex',
  );
});

check('macro-block heads stay near their origin instead of streaking across the board', () => {
  const level = generateSLevel(12);
  const core = level.arrows.filter((arrow) => !arrow.role && typeof arrow.blockId === 'number');
  const byBlock = new Map<number, typeof core>();
  for (const arrow of core) {
    const id = arrow.blockId as number;
    const list = byBlock.get(id) ?? [];
    list.push(arrow);
    byBlock.set(id, list);
  }
  const span = Math.max(level.grid.rows, level.grid.cols);
  const centroids = new Map<number, { row: number; col: number }>();
  for (const [id, arrows] of byBlock) {
    if (arrows.length < 3) continue;
    const heads = arrows.map((arrow) => arrow.cells[arrow.cells.length - 1]);
    const row = heads.reduce((sum, cell) => sum + cell.row, 0) / heads.length;
    const col = heads.reduce((sum, cell) => sum + cell.col, 0) / heads.length;
    centroids.set(id, { row, col });
    const mean = heads.reduce(
      (sum, cell) => sum + Math.abs(cell.row - row) + Math.abs(cell.col - col),
      0,
    ) / heads.length;
    assert(
      mean <= span * 0.42,
      `S12 block ${id} heads averaged ${mean.toFixed(1)} cells from their origin`,
    );
  }

  let cells = 0;
  let leaked = 0;
  for (const arrow of core) {
    const home = centroids.get(arrow.blockId as number);
    if (!home) continue;
    for (const cell of arrow.cells) {
      cells += 1;
      const homeDist = Math.abs(cell.row - home.row) + Math.abs(cell.col - home.col);
      let foreign = false;
      for (const [id, other] of centroids) {
        if (id === arrow.blockId) continue;
        const dist = Math.abs(cell.row - other.row) + Math.abs(cell.col - other.col);
        if (dist + 1 < homeDist) foreign = true;
      }
      if (foreign) leaked += 1;
    }
  }
  assert(cells > 0, 'S12 core produced no measurable block cells');
  assert(
    leaked / cells <= 0.32,
    `S12 core leaked ${(leaked / cells * 100).toFixed(0)}% of its body into other blocks`,
  );
});

check('opening clicks are split across blocks instead of one rim flock', () => {
  const level = generateSLevel(12);
  const opening = level.arrows
    .filter((arrow) => !arrow.role && typeof arrow.solveIndex === 'number')
    .sort((a, b) => (a.solveIndex ?? 0) - (b.solveIndex ?? 0))
    .slice(0, 10);
  const blocks = new Set(opening.map((arrow) => arrow.blockId));
  assert(blocks.size >= 2, `S12 first ten clicks used only ${blocks.size} macro block(s)`);
});

check('adjacent arrows do not unzip in the same escape direction', () => {
  const axisOf = (direction: string): 'h' | 'v' =>
    direction === 'left' || direction === 'right' ? 'h' : 'v';
  for (const index of [8, 40]) {
    const level = generateSLevel(index);
    const owner = new Map<string, (typeof level.arrows)[number]>();
    for (const arrow of level.arrows) {
      if (arrow.role) continue;
      for (const cell of arrow.cells) owner.set(`${cell.row},${cell.col}`, arrow);
    }
    let adjacent = 0;
    let spoons = 0;
    const seen = new Set<string>();
    for (const arrow of level.arrows) {
      if (arrow.role) continue;
      for (const cell of arrow.cells) {
        const sides =
          axisOf(arrow.direction) === 'h'
            ? [
                [1, 0],
                [-1, 0],
              ]
            : [
                [0, 1],
                [0, -1],
              ];
        for (const [dr, dc] of sides) {
          const other = owner.get(`${cell.row + dr},${cell.col + dc}`);
          if (!other || other.id === arrow.id) continue;
          const pair = [arrow.id, other.id].sort().join('|');
          const edge = `${pair}@${Math.min(cell.row, cell.row + dr)},${Math.min(cell.col, cell.col + dc)}`;
          if (seen.has(edge)) continue;
          seen.add(edge);
          adjacent += 1;
          if (other.direction === arrow.direction) spoons += 1;
        }
      }
    }
    assert(
      adjacent === 0 || spoons / adjacent <= 0.2,
      `S${index} had ${spoons} same-direction parallel stacks out of ${adjacent} side-by-side contacts`,
    );
  }
});

check('quadrants mix escape directions instead of lazy border exits', () => {
  const level = generateSLevel(12);
  const rows = level.grid.rows;
  const cols = level.grid.cols;
  const buckets: Record<string, number>[] = [{}, {}, {}, {}];
  const totals = [0, 0, 0, 0];
  for (const arrow of level.arrows) {
    if (arrow.role) continue;
    const head = arrow.cells[arrow.cells.length - 1];
    const zone =
      Math.min(1, Math.floor((head.row * 2) / rows)) * 2 +
      Math.min(1, Math.floor((head.col * 2) / cols));
    buckets[zone][arrow.direction] = (buckets[zone][arrow.direction] ?? 0) + 1;
    totals[zone] += 1;
  }
  for (let zone = 0; zone < 4; zone++) {
    if (totals[zone] < 6) continue;
    for (const [direction, count] of Object.entries(buckets[zone])) {
      const share = count / totals[zone];
      assert(
        share <= 0.5,
        `S12 quadrant ${zone} put ${(share * 100).toFixed(0)}% of heads on ${direction}`,
      );
    }
  }
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

check('fillVacancies packs leftover floor without breaking the schema', () => {
  const level = generateSLevel(11, 8);
  const kept = level.arrows.slice(0, Math.max(6, Math.floor(level.arrows.length * 0.6)));
  const trimmed = {
    ...level,
    arrows: kept,
    metadata: { ...level.metadata, arrowCount: kept.length, solutionOrder: undefined },
  };
  const filled = fillLevelVacancies(trimmed, 21);
  assert(filled.arrows.length > trimmed.arrows.length, 'generate fill added no arrows');
  const parsed = parseLevel(filled);
  assert(parsed.arrows.length === filled.arrows.length, 'filled level failed to round-trip');
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

check('grid sizes stay within the 36x36 to 60x60 range', () => {
  for (const index of [1, 200, 900, 5000]) {
    const level = generateSLevel(index);
    const interior = level.grid.rows - 2;
    assert(interior >= 36 && interior <= 60, `interior ${interior} out of range at S${index}`);
    assert(level.grid.rows === level.grid.matrix.length, 'row count mismatch');
    assert(level.grid.cols === level.grid.matrix[0].length, 'col count mismatch');
  }
});

check('every S-level carries at least 25 arrows', () => {
  for (const index of [1, 2, 3, 17, 200, 5000]) {
    const level = generateSLevel(index);
    assert(
      level.arrows.length >= 25,
      `S${index} only had ${level.arrows.length} arrows`,
    );
  }
});

check('few arrows can escape on the opening move', () => {
  for (const index of [1, 2, 40, 200, 1200]) {
    const level = generateSLevel(index);
    const open = escapableArrowIds(createBoardState(level)).length;

    assert(open > 0, `S${index} has no opening move at all`);
    assert(
      open <= 2,
      `S${index} opened with ${open} free moves; at most two are allowed`,
    );
  }
});

check('gap fillers may sit on the rim, but they do not take over the board', () => {
  const isRimStub = (
    arrow: { cells: readonly { row: number; col: number }[]; direction: string },
    rows: number,
    cols: number,
  ): boolean => {
    if (arrow.cells.length > 4) return false;
    const head = arrow.cells[arrow.cells.length - 1];
    if (arrow.direction === 'up' && head.row <= 2) return true;
    if (arrow.direction === 'down' && head.row >= rows - 3) return true;
    if (arrow.direction === 'left' && head.col <= 2) return true;
    if (arrow.direction === 'right' && head.col >= cols - 3) return true;
    return false;
  };

  for (const index of [1, 2, 40, 200]) {
    const level = generateSLevel(index);
    const stubs = level.arrows.filter((a) =>
      a.role !== 'crumb' && isRimStub(a, level.grid.rows, level.grid.cols),
    );
    assert(
      stubs.length < level.arrows.length * 0.12,
      `S${index} had ${stubs.length} rim stubs out of ${level.arrows.length} arrows`,
    );
  }
});

check('edge arrows usually have to slide, not hop straight off', () => {
  const pointsStraightOff = (
    arrow: { cells: readonly { row: number; col: number }[]; direction: 'up' | 'down' | 'left' | 'right' },
    matrix: readonly (readonly number[])[],
  ): boolean => {
    const head = arrow.cells[arrow.cells.length - 1];
    const delta = DIRECTION_DELTA[arrow.direction];
    const row = head.row + delta.row;
    const col = head.col + delta.col;
    if (row < 0 || col < 0 || row >= matrix.length || col >= (matrix[0]?.length ?? 0)) {
      return true;
    }
    return matrix[row][col] !== CELL_FLOOR;
  };

  for (const index of [1, 2, 40, 200]) {
    const level = generateSLevel(index);
    const easy = level.arrows.filter((arrow) =>
      arrow.role !== 'crumb' && pointsStraightOff(arrow, level.grid.matrix),
    );
    assert(
      easy.length < level.arrows.length * 0.28,
      `S${index} had ${easy.length} of ${level.arrows.length} arrows pointing straight off the board`,
    );
  }
});

const fillRatio = (level: { grid: { matrix: readonly (readonly number[])[] }; arrows: readonly { cells: readonly unknown[] }[] }): number => {
  const floor = level.grid.matrix.flat().filter((cell) => cell === CELL_FLOOR).length;
  const covered = level.arrows.reduce((sum, arrow) => sum + arrow.cells.length, 0);
  return covered / floor;
};

check('S-levels fill nearly the whole silhouette', () => {
  for (const index of [1, 2, 40, 200, 1200]) {
    const level = generateSLevel(index);
    const fill = fillRatio(level);
    assert(fill >= 0.84, `S${index} only filled ${(fill * 100).toFixed(1)}% of the board`);
  }
});

check('some arrows are long and winding, without swallowing the board', () => {
  const turns = (cells: readonly { row: number; col: number }[]): number => {
    let count = 0;
    for (let i = 2; i < cells.length; i++) {
      const d1r = cells[i - 1].row - cells[i - 2].row;
      const d1c = cells[i - 1].col - cells[i - 2].col;
      const d2r = cells[i].row - cells[i - 1].row;
      const d2c = cells[i].col - cells[i - 1].col;
      if (d1r !== d2r || d1c !== d2c) count++;
    }
    return count;
  };

  const longestStraight = (cells: readonly { row: number; col: number }[]): number => {
    let best = 1;
    let run = 1;
    for (let i = 2; i < cells.length; i++) {
      const d1r = cells[i - 1].row - cells[i - 2].row;
      const d1c = cells[i - 1].col - cells[i - 2].col;
      const d2r = cells[i].row - cells[i - 1].row;
      const d2c = cells[i].col - cells[i - 1].col;
      if (d1r === d2r && d1c === d2c) {
        run += 1;
        if (run > best) best = run;
      } else {
        run = 1;
      }
    }
    return best;
  };

  for (const index of [1, 5, 77, 200]) {
    const level = generateSLevel(index);
    const puzzle = level.arrows.filter((a) => !a.role);
    const lengths = puzzle.map((a) => a.cells.length);
    const winding = puzzle.filter((a) => a.cells.length >= 12 && turns(a.cells) >= 3);
    const short = lengths.filter((len) => len <= 3).length;
    const avg = lengths.reduce((sum, len) => sum + len, 0) / lengths.length;
    const long = puzzle.filter((a) => a.cells.length >= 10);
    const stripes = long.filter((a) => longestStraight(a.cells) > 8);
    assert(
      winding.length >= 2,
      `S${index} only had ${winding.length} winding arrows (need a handful, not none)`,
    );
    assert(
      short / lengths.length <= 0.24,
      `S${index} still has ${short} tiny arrows out of ${lengths.length}`,
    );
    assert(avg >= 6, `S${index} average length ${avg.toFixed(1)} is too stubby`);
    assert(
      Math.max(...lengths) >= 16,
      `S${index} produced no really long arrow`,
    );
    assert(
      stripes.length <= Math.max(1, Math.floor(long.length * 0.2)),
      `S${index} still has ${stripes.length} long-parallel arrows out of ${long.length}`,
    );
  }
});

check('some arrows lock more than one escape path', () => {
  const level = generateSLevel(40);
  const live = new Set(escapableArrowIds(createBoardState(level)));
  let masters = 0;
  for (const arrow of level.arrows) {
    const without = level.arrows.filter((other) => other.id !== arrow.id);
    const occupancy = new OccupancyIndex(without);
    let freed = 0;
    for (const other of without) {
      if (live.has(other.id)) continue;
      if (resolveSlide(other, level.grid, occupancy).outcome === 'escaped') freed += 1;
    }
    if (freed >= 2) masters += 1;
  }
  assert(masters >= 1, `S40 had no arrows that locked two or more paths`);
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

check('the ending-test demo is a dense 7×7 solvable board', () => {
  const parsed = parseLevel(DEMO_ENDING_LEVEL);
  assert(parsed.grid.rows === 9 && parsed.grid.cols === 9, 'demo stores a 7×7 playable board plus a pass-through ring');
  assert(parsed.arrows.length >= 12, 'demo should have enough arrows to miss a few');
  assert(isSolvable(parsed), 'demo ending board is not solvable');
});

check('a bent arrow is judged only by its head ray', () => {
  // Arrows snake, so a body cell sitting in another arrow's row must not block.
  const level = parseLevel({
    id: '900',
    source: 'curated',
    version: 1,
    grid: {
      rows: 5,
      cols: 5,
      matrix: [
        [1, 1, 1, 1, 1],
        [1, 0, 0, 0, 1],
        [1, 0, 0, 0, 1],
        [1, 0, 0, 0, 1],
        [1, 1, 1, 1, 1],
      ],
    },
    arrows: [
      // Bent arrow: tail at (3,1), turns up, head at (1,2) pointing up.
      {
        id: 'bent',
        cells: [
          { row: 3, col: 1 },
          { row: 2, col: 1 },
          { row: 2, col: 2 },
          { row: 1, col: 2 },
        ],
        direction: 'up',
      },
      // Sits in row 3, which the bent arrow's tail occupies but never sweeps.
      { id: 'other', cells: [{ row: 3, col: 2 }, { row: 3, col: 3 }], direction: 'right' },
    ],
    metadata: { arrowCount: 2 },
  });

  const bent = level.arrows[0];
  const result = resolveSlide(bent, level.grid, new OccupancyIndex(level.arrows));
  assert(
    result.outcome === 'escaped',
    'bent arrow with a clear head ray should escape despite a neighbour in its tail row',
  );
  assert(
    result.distance === result.headSteps + bent.cells.length - 1,
    'escape distance must include the body following the head',
  );
});

check('a blocked tap costs exactly one life, and three end the run', () => {
  const level = parseLevel({
    id: '903',
    source: 'curated',
    version: 1,
    grid: {
      rows: 4,
      cols: 5,
      matrix: [
        [1, 1, 1, 1, 1],
        [1, 0, 0, 0, 1],
        [1, 0, 0, 0, 1],
        [1, 1, 1, 1, 1],
      ],
    },
    arrows: [
      { id: 'mover', cells: [{ row: 1, col: 1 }, { row: 1, col: 2 }], direction: 'right' },
      { id: 'wall', cells: [{ row: 1, col: 3 }, { row: 2, col: 3 }], direction: 'down' },
    ],
    metadata: { arrowCount: 2 },
  });

  let state = createBoardState(level);
  assert(state.lives === MAX_LIVES, 'a fresh board starts on full lives');

  for (let attempt = 1; attempt <= MAX_LIVES; attempt++) {
    const resolution = applyTap(state, 'mover');
    assert(resolution !== null, `tap ${attempt} should resolve`);
    assert(resolution!.result.outcome === 'blocked', `tap ${attempt} should be blocked`);
    state = resolution!.nextState;
    assert(
      state.lives === MAX_LIVES - attempt,
      `after ${attempt} blocked taps lives should be ${MAX_LIVES - attempt}, got ${state.lives}`,
    );
  }

  assert(state.status === 'lost', 'running out of lives should end the run');
  assert(applyTap(state, 'mover') === null, 'a finished board ignores further taps');
});

check('parser rejects an arrowhead that is not on a straight neck', () => {
  let rejected = false;
  try {
    parseLevel({
      id: '902',
      source: 'curated',
      version: 1,
      grid: {
        rows: 3,
        cols: 4,
        matrix: [
          [1, 1, 1, 1],
          [1, 0, 0, 1],
          [1, 1, 1, 1],
        ],
      },
      // Cells run rightward but the arrow claims to point up.
      arrows: [
        { id: 'bad', cells: [{ row: 1, col: 1 }, { row: 1, col: 2 }], direction: 'up' },
      ],
      metadata: { arrowCount: 1 },
    });
  } catch {
    rejected = true;
  }
  assert(rejected, 'an off-axis arrowhead should be rejected');
});

check('an arrow blocked directly ahead recoils', () => {
  const level = parseLevel({
    id: '901',
    source: 'curated',
    version: 1,
    grid: {
      rows: 4,
      cols: 5,
      matrix: [
        [1, 1, 1, 1, 1],
        [1, 0, 0, 0, 1],
        [1, 0, 0, 0, 1],
        [1, 1, 1, 1, 1],
      ],
    },
    arrows: [
      { id: 'mover', cells: [{ row: 1, col: 1 }, { row: 1, col: 2 }], direction: 'right' },
      { id: 'wall', cells: [{ row: 1, col: 3 }, { row: 2, col: 3 }], direction: 'down' },
    ],
    metadata: { arrowCount: 2 },
  });

  const result = resolveSlide(
    level.arrows[0],
    level.grid,
    new OccupancyIndex(level.arrows),
  );
  assert(result.outcome === 'blocked', 'arrow should be blocked');
  assert(result.blockedBy === 'wall', `expected block by wall, got ${result.blockedBy}`);
  assert(result.distance === 0, `expected no free travel, got ${result.distance}`);
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
