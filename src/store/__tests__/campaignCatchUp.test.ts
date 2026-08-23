import { campaignCatchUp } from '../campaignCatchUp';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const midEndless = {
  clearedCuratedLevels: 10,
  currentCuratedLevel: null as number | null,
  currentSLevelIndex: 6,
  leftCuratedByChoice: true,
};

const stayOnS6 = campaignCatchUp(midEndless, 12, { unfinishedEndlessRun: true });
assert(stayOnS6 === null, 'an unfinished endless board must be finished before new campaign levels');

const afterS6 = campaignCatchUp(midEndless, 12, { unfinishedEndlessRun: false });
assert(afterS6?.currentCuratedLevel === 11, `after that board, campaign should resume at 11, got ${afterS6?.currentCuratedLevel}`);
assert(afterS6?.leftCuratedByChoice === false, 'catch-up is not a player jump into Endless');

const alreadyOn11 = campaignCatchUp(
  { ...midEndless, currentCuratedLevel: 11 },
  12,
  { unfinishedEndlessRun: false },
);
assert(alreadyOn11 === null, 'do not rewind a player who is already on the next campaign board');

const noNewLevels = campaignCatchUp(midEndless, 10, { unfinishedEndlessRun: false });
assert(noNewLevels === null, 'no catch-up when the catalog has not grown past what they cleared');

console.log('  PASS  new campaign levels wait for the current endless board, then resume');
