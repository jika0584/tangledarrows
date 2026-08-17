import * as SQLite from 'expo-sqlite';
import { Level } from '../levels/types';
import { parseLevel } from '../levels/parser';

const DB_NAME = 'amaze-escape.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS levels (
          id TEXT PRIMARY KEY NOT NULL,
          level_number INTEGER NOT NULL,
          batch_id TEXT NOT NULL,
          payload TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_levels_number ON levels (level_number);
        CREATE INDEX IF NOT EXISTS idx_levels_batch ON levels (batch_id);
      `);
      return db;
    });
  }
  return dbPromise;
}

/**
 * On-device store for downloaded curated levels.
 * Only the active batch is retained — cleared batches are purged so the install
 * footprint stays small no matter how far the player progresses.
 */
export const LocalCache = {
  async saveBatch(batchId: string, levels: Level[]): Promise<void> {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      for (const level of levels) {
        await db.runAsync(
          'INSERT OR REPLACE INTO levels (id, level_number, batch_id, payload) VALUES (?, ?, ?, ?)',
          level.id,
          parseInt(level.id, 10),
          batchId,
          JSON.stringify(level),
        );
      }
    });
  },

  async getLevel(levelNumber: number): Promise<Level | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ payload: string }>(
      'SELECT payload FROM levels WHERE level_number = ? LIMIT 1',
      levelNumber,
    );
    if (!row) return null;

    try {
      return parseLevel(JSON.parse(row.payload));
    } catch {
      // Drop unreadable rows so the next sync can replace them.
      await db.runAsync('DELETE FROM levels WHERE level_number = ?', levelNumber);
      return null;
    }
  },

  async hasLevel(levelNumber: number): Promise<boolean> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM levels WHERE level_number = ?',
      levelNumber,
    );
    return (row?.count ?? 0) > 0;
  },

  /** Deletes every cached level below the player's current position. */
  async purgeCompletedBelow(levelNumber: number): Promise<number> {
    const db = await getDb();
    const result = await db.runAsync(
      'DELETE FROM levels WHERE level_number < ?',
      levelNumber,
    );
    return result.changes ?? 0;
  },

  async highestCachedLevel(): Promise<number | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ maxLevel: number | null }>(
      'SELECT MAX(level_number) as maxLevel FROM levels',
    );
    return row?.maxLevel ?? null;
  },

  async countCached(): Promise<number> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM levels',
    );
    return row?.count ?? 0;
  },

  async clear(): Promise<void> {
    const db = await getDb();
    await db.execAsync('DELETE FROM levels');
  },
};
