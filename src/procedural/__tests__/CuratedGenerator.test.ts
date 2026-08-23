/**
 * Campaign-generator checks. Run with: npm run test:levels
 */
import {
  CAMPAIGN_STORED_SIZES,
  FIRST_CURATED_LEVEL,
  generateCuratedLevel,
  profileForLevel,
  rectangleMatrix,
  SINGLE_LEVEL_STORED_SIZES,
} from '../CuratedGenerator';
import { parseLevel } from '../../levels/parser';
import { isSolvable } from '../../game/engine/WinCondition';
import { CELL_FLOOR } from '../../levels/types';

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

check('campaign is hard-only and steps 37 / 50 / 62 / 74', () => {
  const early = profileForLevel(5);
  const small = profileForLevel(1500);
  const mid = profileForLevel(4000);
  const late = profileForLevel(8000);

  assert(early.difficulty === 'hard', `level 5 should be hard, got ${early.difficulty}`);
  assert(mid.difficulty === 'hard', `mid campaign should be hard, got ${mid.difficulty}`);
  assert(late.difficulty === 'hard', `late campaign should be hard, got ${late.difficulty}`);
  assert(early.interiorSize === 37, `opening boards should be 37, got ${early.interiorSize}`);
  assert(small.interiorSize === 50, `early-mid boards should be 50, got ${small.interiorSize}`);
  assert(mid.interiorSize === 62, `mid boards should be 62, got ${mid.interiorSize}`);
  assert(late.interiorSize === 74, `late boards should be 74, got ${late.interiorSize}`);
  assert(early.prefer === 'tight', 'hard boards should prefer tight openings');
});

check('generated campaign levels parse as curated and are solvable', () => {
  const level = generateCuratedLevel(FIRST_CURATED_LEVEL, { seedAttempts: 1 });
  const parsed = parseLevel(level);
  assert(parsed.source === 'curated', 'should be curated');
  assert(parsed.id === String(FIRST_CURATED_LEVEL), `expected id ${FIRST_CURATED_LEVEL}, got ${parsed.id}`);
  assert(parsed.metadata.difficulty === 'hard', 'campaign levels must be hard');
  assert(parsed.grid.rows === 39, `37 interior plus border should be 39, got ${parsed.grid.rows}`);
  assert(parsed.arrows.length > 0, 'generated no arrows');
  assert(isSolvable(parsed), 'level is not solvable');
});

check('hard boards fill instead of looking patchy', () => {
  const level = generateCuratedLevel(FIRST_CURATED_LEVEL, { seed: 12345 });
  const floor = level.grid.matrix.flat().filter((cell) => cell === CELL_FLOOR).length;
  const covered = level.arrows.reduce((sum, arrow) => sum + arrow.cells.length, 0);
  assert(level.arrows.length >= 50, `level 5 only placed ${level.arrows.length} arrows`);
  assert(covered / floor >= 0.7, `level 5 fill ${(covered / floor).toFixed(2)} is too sparse`);
});

check('campaign picker includes 91×91', () => {
  assert(CAMPAIGN_STORED_SIZES.includes(91), '91 is missing from campaign sizes');
  const grid = rectangleMatrix(91);
  assert(grid.length === 91, `91×91 matrix was ${grid.length}`);
  assert(grid[1][1] === CELL_FLOOR, 'interior of 91×91 should be floor');
});

check('custom board sizes work across the 24–150 range', () => {
  const grid = rectangleMatrix(120);
  assert(grid.length === 120, `120×120 matrix was ${grid.length}`);
  assert(grid[1][1] === CELL_FLOOR, 'interior of 120×120 should be floor');
  assert(grid[0][0] !== CELL_FLOOR, '120×120 should keep a pass-through ring');
  assert(CAMPAIGN_STORED_SIZES.includes(91), '91 remains a campaign default');
  assert(SINGLE_LEVEL_STORED_SIZES.includes(150), '150 remains the hard max preset');
});

check('same seed reproduces the same campaign level', () => {
  const a = generateCuratedLevel(7, { seed: 12345 });
  const b = generateCuratedLevel(7, { seed: 12345 });
  assert(JSON.stringify(a.arrows) === JSON.stringify(b.arrows), 'arrows differed');
  assert(JSON.stringify(a.grid) === JSON.stringify(b.grid), 'grids differed');
});

if (failures > 0) {
  console.error(`\n${failures} curated-generator test(s) failed`);
  process.exit(1);
}

console.log('\nAll curated-generator checks passed.');
