import { Level, formatSLevelId } from '../levels/types';
import { FIRST_CURATED_LEVEL, LAST_CURATED_LEVEL, generateCuratedLevel } from '../procedural/CuratedGenerator';
import { generateSLevel } from '../procedural/SLevelGenerator';
import { useCatalogStamp } from '../store/catalogStamp';
import { BatchDownloader } from './BatchDownloader';
import { LocalCache } from './LocalCache';
import { isSupabaseConfigured } from './supabaseClient';

export interface LevelRequest {
  /** Next curated level to serve, or null once the curated tier is exhausted. */
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
 *   3. Locally generated campaign board only for a hole inside the known catalog.
 *   4. Procedural S-level once the numbered campaign has actually run out.
 */
export const LevelRepository = {
  async getNextLevel(request: LevelRequest): Promise<ResolvedLevel> {
    const { curatedLevel, sLevelIndex } = request;

    if (curatedLevel !== null && curatedLevel >= FIRST_CURATED_LEVEL && curatedLevel <= LAST_CURATED_LEVEL) {
      const cached = await LocalCache.getLevel(curatedLevel);
      if (cached) {
        void this.prefetch(curatedLevel);
        return { level: cached, usedFallback: false };
      }

      const result = await BatchDownloader.ensureBatch(curatedLevel);
      if (result.status !== 'offline') {
        const downloaded = await LocalCache.getLevel(curatedLevel);
        if (downloaded) return { level: downloaded, usedFallback: false };
      }

      // Only invent a local campaign board for a hole inside the known catalog.
      // Past the last uploaded number, Endless takes over — otherwise finishing
      // 10 cloud levels would generate 11, 12, … forever.
      const ceiling = await campaignCeiling();
      if (ceiling !== null && curatedLevel <= ceiling) {
        try {
          return {
            level: generateCuratedLevel(curatedLevel, { seedAttempts: 1 }),
            usedFallback: false,
          };
        } catch {
          // Fall through to the endless tier if generation itself fails.
        }
      }
    }

    return {
      level: generateSLevel(sLevelIndex),
      usedFallback: true,
    };
  },

  /**
   * Silent launch sync. Fills the cache from the player's current campaign
   * position, then tries one extra batch beyond whatever is already stored so
   * newly uploaded puzzles show up without a UI or a loading gate.
   */
  async syncOnLaunch(curatedLevel: number | null): Promise<void> {
    await this.syncCatalog(curatedLevel, { forceCurrentWindow: false });
  },

  /**
   * Manual refresh. Re-reads the player's current window so replaced rows are
   * noticed, then pulls anything sitting past the cache.
   */
  async syncNow(curatedLevel: number | null): Promise<{ changed: number }> {
    return this.syncCatalog(curatedLevel, { forceCurrentWindow: true });
  },

  /**
   * Downloads every remaining curated batch from the campaign start, then
   * reports how far the cloud catalog currently goes.
   */
  async syncFullCatalog(): Promise<{ highest: number | null; error?: string }> {
    const remote = await BatchDownloader.highestRemoteLevel();

    try {
      if (isSupabaseConfigured()) {
        let start = FIRST_CURATED_LEVEL;
        for (let i = 0; i < 40; i++) {
          const result = await BatchDownloader.fetchBatchStartingAt(start);
          if (result.status !== 'downloaded' || !result.manifest) break;
          start = result.manifest.endLevel + 1;
        }
      }
    } catch {
      // Picker still lists the remote high-water mark even if payloads lag.
    }

    const cached = await LocalCache.highestCachedLevel();
    const highest = Math.max(cached ?? 0, remote.highest ?? 0);
    await useCatalogStamp.getState().recordHighest(highest > 0 ? highest : null);
    return {
      highest: highest > 0 ? highest : null,
      error: remote.error,
    };
  },

  async syncCatalog(
    curatedLevel: number | null,
    opts: { forceCurrentWindow: boolean },
  ): Promise<{ changed: number }> {
    if (!isSupabaseConfigured()) return { changed: 0 };

    try {
      const from =
        curatedLevel === null ? FIRST_CURATED_LEVEL : Math.max(curatedLevel, FIRST_CURATED_LEVEL);

      let changed = 0;
      if (opts.forceCurrentWindow) {
        const current = await BatchDownloader.fetchBatchStartingAt(from);
        changed += current.levelsAdded;
      } else {
        const current = await BatchDownloader.ensureBatch(from);
        changed += current.levelsAdded;
      }

      const highest = await LocalCache.highestCachedLevel();
      if (highest !== null && highest >= from) {
        const ahead = await BatchDownloader.fetchBatchStartingAt(highest + 1);
        changed += ahead.levelsAdded;
      }

      await rememberCatalogExtent();
      return { changed };
    } catch {
      return { changed: 0 };
    }
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

  /** Deterministic by default; pass `randomize` to get a fresh layout for this index. */
  getSLevel(index: number, randomize = false): Level {
    const level = generateSLevel(
      index,
      undefined,
      randomize ? { forceRandomize: true } : undefined,
    );
    return { ...level, id: formatSLevelId(index) };
  },
};

async function campaignCeiling(): Promise<number | null> {
  const stamped = useCatalogStamp.getState().highestCampaign;
  const cached = await LocalCache.highestCachedLevel();
  const highest = Math.max(stamped ?? 0, cached ?? 0);
  return highest > 0 ? highest : null;
}

async function rememberCatalogExtent(): Promise<void> {
  const remote = await BatchDownloader.highestRemoteLevel();
  const cached = await LocalCache.highestCachedLevel();
  const highest = Math.max(cached ?? 0, remote.highest ?? 0);
  await useCatalogStamp.getState().recordHighest(highest > 0 ? highest : null);
}
