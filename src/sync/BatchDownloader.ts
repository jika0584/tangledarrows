import { Level, LevelBatchManifest } from '../levels/types';
import { parseLevel } from '../levels/parser';
import { useCatalogStamp } from '../store/catalogStamp';
import { useProgressStore } from '../store/progressStore';
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
    return this.fetchBatchStartingAt(startLevel);
  },

  /**
   * Pulls one batch starting at `startLevel`, even if the local cache already
   * looks full. Used on launch so newly uploaded rows arrive without waiting
   * for the player to reach the end of the previous batch.
   */
  async fetchBatchStartingAt(startLevel: number): Promise<BatchDownloadResult> {
    const supabase = getSupabase();
    if (!supabase) return { status: 'offline', levelsAdded: 0 };

    const { data, error } = await supabase
      .from('levels')
      .select('level_number, payload')
      .gte('level_number', startLevel)
      .order('level_number', { ascending: true })
      .limit(BATCH_SIZE);

    if (error) return { status: 'offline', levelsAdded: 0 };
    if (!data || data.length === 0) return { status: 'exhausted', levelsAdded: 0 };

    const levels = parseRows(data as LevelRow[]);
    if (levels.length === 0) return { status: 'exhausted', levelsAdded: 0 };

    const numbers = (data as LevelRow[]).map((row) => row.level_number);
    const endLevel = numbers[numbers.length - 1] ?? startLevel + BATCH_SIZE - 1;
    const batchId = `batch-${startLevel}-${endLevel}`;
    const changed = await LocalCache.saveBatch(batchId, levels);
    if (changed.changed > 0) {
      await useCatalogStamp.getState().recordUpdate();
    }
    if (changed.regeneratedLevelNumbers.length > 0) {
      await useProgressStore.getState().markLevelsRegenerated(changed.regeneratedLevelNumbers);
    }

    return {
      status: 'downloaded',
      levelsAdded: changed.changed,
      manifest: {
        batchId,
        startLevel,
        endLevel,
        levelCount: levels.length,
      },
    };
  },

  /** Highest numbered campaign row in the cloud table, if any. */
  async highestRemoteLevel(): Promise<{ highest: number | null; error?: string }> {
    const supabase = getSupabase();
    if (!supabase) {
      return { highest: null, error: 'Cloud catalog is not configured on this build.' };
    }

    const { data, error } = await supabase
      .from('levels')
      .select('level_number')
      .order('level_number', { ascending: false })
      .limit(1);

    if (error) return { highest: null, error: error.message };
    if (data?.[0]?.level_number != null) {
      return { highest: data[0].level_number };
    }

    return { highest: null };
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
      const patched =
        raw && typeof raw === 'object'
          ? { ...(raw as object), id: String(row.level_number), source: 'curated' }
          : raw;
      levels.push(parseLevel(patched));
    } catch {
      continue;
    }
  }
  return levels;
}
