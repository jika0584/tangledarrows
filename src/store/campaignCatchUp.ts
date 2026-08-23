/**
 * Inserts newly arrived campaign boards after the player has already moved
 * into Endless. The current unfinished endless run is left alone; catch-up
 * starts on the next board after that run is cleared (or immediately if
 * nothing is in progress).
 */
export function campaignCatchUp(
  state: { clearedCuratedLevels: number; currentCuratedLevel: number | null },
  highestCampaign: number,
  options: { unfinishedEndlessRun: boolean },
): { currentCuratedLevel: number; leftCuratedByChoice: false } | null {
  if (!Number.isFinite(highestCampaign) || highestCampaign < 1) return null;

  const nextCampaign = state.clearedCuratedLevels + 1;
  if (nextCampaign > highestCampaign) return null;
  if (options.unfinishedEndlessRun) return null;
  if (state.currentCuratedLevel === nextCampaign) return null;

  return {
    currentCuratedLevel: nextCampaign,
    leftCuratedByChoice: false,
  };
}
