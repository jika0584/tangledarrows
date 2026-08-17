import { Level, formatSLevelId } from '../levels/types';
import { generateSLevel } from '../procedural/SLevelGenerator';
import { BatchDownloader } from './BatchDownloader';
import { LocalCache } from './LocalCache';

export interface LevelRequest {
  /** Next curated level to play, or null once the curated tier is exhausted. */
  curatedLevel: number | null;
  /** Position in the infinite procedural tier. */
  sLevelIndex: number;
}

export interface ResolvedLevel {
  level: Level;
  /** True when curated content ran out and the S-tier took over. */
  usedFallback: boolean;
}

/**
 * Single entry point the game screen uses to obtain a level.
 *
 * Order of resolution:
 *   1. Cached curated level, if present.
 *   2. Freshly downloaded curated batch.
 *   3. Locally generated S-level — always available, works fully offline.
 */
export const LevelRepository = {
  async getNextLevel(request: LevelRequest): Promise<ResolvedLevel> {
    const { curatedLevel, sLevelIndex } = request;

    if (curatedLevel !== null) {
      const cached = await LocalCache.getLevel(curatedLevel);
      if (cached) {
        void this.prefetch(curatedLevel);
        return { level: cached, usedFallback: false };
      }

      const result = await BatchDownloader.ensureBatch(curatedLevel);
      if (result.status === 'downloaded') {
        const downloaded = await LocalCache.getLevel(curatedLevel);
        if (downloaded) return { level: downloaded, usedFallback: false };
      }
    }

    return {
      level: generateSLevel(sLevelIndex),
      usedFallback: true,
    };
  },

  /** Warms the next batch in the background; failures are non-fatal. */
  async prefetch(currentLevel: number): Promise<void> {
    try {
      await BatchDownloader.ensureBatch(currentLevel + 1);
    } catch {
      // Offline play continues from cache or the procedural tier.
    }
  },

  /** Called after a win to reclaim storage from finished levels. */
  async onLevelCompleted(levelId: string): Promise<void> {
    if (levelId.startsWith('S')) return;
    const levelNumber = parseInt(levelId, 10);
    if (Number.isNaN(levelNumber)) return;

    try {
      await BatchDownloader.purgeCompleted(levelNumber);
      await BatchDownloader.ensureBatch(levelNumber + 1);
    } catch {
      // Cleanup and prefetch are best-effort.
    }
  },

  /** Deterministic regeneration, used for replaying a specific S-level. */
  getSLevel(index: number): Level {
    const level = generateSLevel(index);
    return { ...level, id: formatSLevelId(index) };
  },
};
