import { formatSLevelId } from '../../src/levels/types';

/** Catalog keys for endless boards are negative: S7 ↔ -7. Campaign stays ≥ 1. */
export function isEndlessCatalogKey(levelNumber: number): boolean {
  return levelNumber < 0;
}

export function isCampaignCatalogKey(levelNumber: number): boolean {
  return levelNumber >= 1;
}

export function endlessCatalogKey(sLevelIndex: number): number {
  if (sLevelIndex < 1) throw new RangeError(`Endless index must be ≥ 1, got ${sLevelIndex}`);
  return -sLevelIndex;
}

export function sLevelIndexFromCatalogKey(levelNumber: number): number {
  if (!isEndlessCatalogKey(levelNumber)) {
    throw new RangeError(`Not an endless catalog key: ${levelNumber}`);
  }
  return -levelNumber;
}

export function catalogKeyFromLevelId(id: string): number {
  const endless = /^S(\d+)$/i.exec(id.trim());
  if (endless) return endlessCatalogKey(parseInt(endless[1], 10));
  const n = parseInt(id, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new RangeError(`Unrecognized level id: ${id}`);
  }
  return n;
}

export function displayLevelLabel(levelNumber: number): string {
  return isEndlessCatalogKey(levelNumber)
    ? formatSLevelId(sLevelIndexFromCatalogKey(levelNumber))
    : String(levelNumber);
}
