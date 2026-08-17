import { Level, LevelBatchManifest } from '../levels/types';
import { parseLevel } from '../levels/parser';
import { getSupabase } from './supabaseClient';
import { LocalCache } from './LocalCache';

/** Levels fetched per network round trip. */
export const BATCH_SIZE = 25;

/** Refill once the player is this close to the end of the cached batch. */
export const PREFETCH_THRESHOLD = 8;

export interface BatchDownloadResult {
  status: 'downloaded' | 'up-to-date' | 'exhausted' | 'offline';
  levelsAdded: number;
  manifest?: LevelBatchManifest;
}

interface LevelRow {
  level_number: number;
  payload: unknown;
}

/**
 * Downloads curated levels in batches and hands them to the local cache.
 *
 * Rows are expected in a `levels` table shaped as:
 *   level_number int primary key, payload jsonb
 * The payload is the same Level document the game reads locally.
 */
export const BatchDownloader = {
  /**
   * Ensures levels from `fromLevel` onward are cached.
   * Returns 'exhausted' when the curated tier has no more content, which is the
   * signal for the app to switch to procedurally generated S-levels.
   */
  async ensureBatch(fromLevel: number): Promise<BatchDownloadResult> {
    const supabase = getSupabase();
    if (!supabase) return { status: 'offline', levelsAdded: 0 };

    const highestCached = await LocalCache.highestCachedLevel();
    if (highestCached !== null && highestCached - fromLevel >= PREFETCH_THRESHOLD) {
      return { status: 'up-to-date', levelsAdded: 0 };
    }

    const startLevel = Math.max(fromLevel, (highestCached ?? fromLevel - 1) + 1);
    const endLevel = startLevel + BATCH_SIZE - 1;

    const { data, error } = await supabase
      .from('levels')
      .select('level_number, payload')
      .gte('level_number', startLevel)
      .lte('level_number', endLevel)
      .order('level_number', { ascending: true });

    if (error) return { status: 'offline', levelsAdded: 0 };
    if (!data || data.length === 0) return { status: 'exhausted', levelsAdded: 0 };

    const levels = parseRows(data as LevelRow[]);
    if (levels.length === 0) return { status: 'exhausted', levelsAdded: 0 };

    const batchId = `batch-${startLevel}-${endLevel}`;
    await LocalCache.saveBatch(batchId, levels);

    return {
      status: 'downloaded',
      levelsAdded: levels.length,
      manifest: {
        batchId,
        startLevel,
        endLevel,
        levelCount: levels.length,
      },
    };
  },

  /**
   * Frees storage once a level is cleared. Keeps a small trailing window so the
   * player can replay the level they just finished.
   */
  async purgeCompleted(currentLevel: number, keepBehind = 2): Promise<number> {
    return LocalCache.purgeCompletedBelow(Math.max(1, currentLevel - keepBehind));
  },
};

/** Skips malformed rows rather than failing the whole batch. */
function parseRows(rows: LevelRow[]): Level[] {
  const levels: Level[] = [];
  for (const row of rows) {
    try {
      const raw =
        typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      levels.push(parseLevel(raw));
    } catch {
      continue;
    }
  }
  return levels;
}
