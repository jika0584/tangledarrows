import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CELL_FLOOR, CELL_OUTSIDE, Level } from '../../src/levels/types';
import { parseLevel } from '../../src/levels/parser';
import { projectRoot } from './env';
import {
  catalogKeyFromLevelId,
  isCampaignCatalogKey,
  isEndlessCatalogKey,
} from './endlessIds';

export interface CatalogRow {
  levelNumber: number;
  difficulty: string | null;
  arrowCount: number;
  gridSize: number;
  generatedAt: string;
  uploadedAt: string | null;
  /** True when the board came from an image / non-square silhouette. */
  shaped: boolean;
}

let db: DatabaseSync | null = null;

function dataDir(): string {
  return join(projectRoot(), 'tools', 'px', 'data');
}

export function catalogPath(): string {
  return join(dataDir(), 'levels.db');
}

function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(dataDir(), { recursive: true });
  db = new DatabaseSync(catalogPath());
  db.exec(`
    CREATE TABLE IF NOT EXISTS levels (
      level_number INTEGER PRIMARY KEY,
      payload TEXT NOT NULL,
      difficulty TEXT,
      arrow_count INTEGER NOT NULL,
      grid_size INTEGER NOT NULL,
      generated_at TEXT NOT NULL,
      uploaded_at TEXT
    );
  `);
  ensureShapedColumn(db);
  return db;
}

function ensureShapedColumn(database: DatabaseSync): void {
  const cols = database.prepare('PRAGMA table_info(levels)').all() as Array<{ name: string }>;
  if (cols.some((col) => col.name === 'shaped')) return;
  database.exec('ALTER TABLE levels ADD COLUMN shaped INTEGER NOT NULL DEFAULT 0');
  backfillShaped(database);
}

function backfillShaped(database: DatabaseSync): void {
  const rows = database.prepare('SELECT level_number, payload FROM levels').all() as Array<{
    level_number: number;
    payload: string;
  }>;
  const update = database.prepare('UPDATE levels SET shaped = ? WHERE level_number = ?');
  for (const row of rows) {
    try {
      update.run(levelUsedImage(JSON.parse(row.payload) as Level) ? 1 : 0, row.level_number);
    } catch {
      // Leave the default if an old payload cannot be read.
    }
  }
}

function isRectangularBoard(level: Level): boolean {
  const { rows, cols, matrix } = level.grid;
  if (rows < 3 || cols < 3) return false;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const border = r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
      const expected = border ? CELL_OUTSIDE : CELL_FLOOR;
      if (matrix[r][c] !== expected) return false;
    }
  }
  return true;
}

export function levelUsedImage(level: Level): boolean {
  if (level.metadata?.shapeSource) return true;
  if (!level.grid?.matrix) return false;
  return !isRectangularBoard(level);
}

function toRow(row: {
  level_number: number;
  difficulty: string | null;
  arrow_count: number;
  grid_size: number;
  generated_at: string;
  uploaded_at: string | null;
  shaped: number;
}): CatalogRow {
  return {
    levelNumber: row.level_number,
    difficulty: row.difficulty,
    arrowCount: row.arrow_count,
    gridSize: row.grid_size,
    generatedAt: row.generated_at,
    uploadedAt: row.uploaded_at,
    shaped: row.shaped === 1,
  };
}

export const Catalog = {
  save(level: Level): void {
    const levelNumber = catalogKeyFromLevelId(level.id);
    const payload = JSON.stringify(level);
    const generatedAt = level.metadata.authoredAt ?? new Date().toISOString();

    getDb()
      .prepare(
        `INSERT INTO levels (
            level_number, payload, difficulty, arrow_count, grid_size, generated_at, uploaded_at, shaped
          ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
          ON CONFLICT(level_number) DO UPDATE SET
            payload = excluded.payload,
            difficulty = excluded.difficulty,
            arrow_count = excluded.arrow_count,
            grid_size = excluded.grid_size,
            generated_at = excluded.generated_at,
            uploaded_at = NULL,
            shaped = excluded.shaped`,
      )
      .run(
        levelNumber,
        payload,
        level.metadata.difficulty ?? null,
        level.arrows.length,
        level.grid.rows,
        generatedAt,
        levelUsedImage(level) ? 1 : 0,
      );
  },

  get(levelNumber: number): Level | null {
    const row = getDb()
      .prepare('SELECT payload FROM levels WHERE level_number = ?')
      .get(levelNumber) as { payload: string } | undefined;
    if (!row) return null;
    return parseLevel(JSON.parse(row.payload));
  },

  list(from: number, to: number): CatalogRow[] {
    const rows = getDb()
      .prepare(
        `SELECT level_number, difficulty, arrow_count, grid_size, generated_at, uploaded_at, shaped
         FROM levels
         WHERE level_number >= ? AND level_number <= ?
         ORDER BY level_number`,
      )
      .all(from, to) as Array<{
      level_number: number;
      difficulty: string | null;
      arrow_count: number;
      grid_size: number;
      generated_at: string;
      uploaded_at: string | null;
      shaped: number;
    }>;

    return rows.map(toRow);
  },

  payloadRange(from: number, to: number): { levelNumber: number; level: Level }[] {
    const rows = getDb()
      .prepare(
        `SELECT level_number, payload FROM levels
         WHERE level_number >= ? AND level_number <= ?
         ORDER BY level_number`,
      )
      .all(from, to) as Array<{ level_number: number; payload: string }>;

    return rows.map((row) => ({
      levelNumber: row.level_number,
      level: parseLevel(JSON.parse(row.payload)),
    }));
  },

  markUploaded(levelNumbers: number[]): void {
    if (levelNumbers.length === 0) return;
    const statement = getDb().prepare(
      'UPDATE levels SET uploaded_at = ? WHERE level_number = ?',
    );
    const now = new Date().toISOString();
    for (const n of levelNumbers) {
      if (!isCampaignCatalogKey(n) && !isEndlessCatalogKey(n)) continue;
      statement.run(now, n);
    }
  },

  /** Highest campaign (positive) level number. */
  highest(): number | null {
    const row = getDb()
      .prepare(
        'SELECT MAX(level_number) AS max_level FROM levels WHERE level_number >= 1',
      )
      .get() as { max_level: number | null };
    return row.max_level;
  },

  highestFrom(min: number): number | null {
    const row = getDb()
      .prepare(
        'SELECT MAX(level_number) AS max_level FROM levels WHERE level_number >= ?',
      )
      .get(Math.max(1, min)) as { max_level: number | null };
    return row.max_level;
  },

  /** Highest endless S-index currently stored (1-based), or null. */
  highestEndlessIndex(): number | null {
    const row = getDb()
      .prepare(
        'SELECT MIN(level_number) AS min_level FROM levels WHERE level_number < 0',
      )
      .get() as { min_level: number | null };
    if (row.min_level == null) return null;
    return -row.min_level;
  },

  count(): number {
    const row = getDb()
      .prepare('SELECT COUNT(*) AS count FROM levels WHERE level_number >= 1')
      .get() as { count: number };
    return row.count;
  },

  endlessCount(): number {
    const row = getDb()
      .prepare('SELECT COUNT(*) AS count FROM levels WHERE level_number < 0')
      .get() as { count: number };
    return row.count;
  },

  pendingUploadCount(): number {
    const row = getDb()
      .prepare(
        'SELECT COUNT(*) AS count FROM levels WHERE uploaded_at IS NULL AND level_number >= 1',
      )
      .get() as { count: number };
    return row.count;
  },

  pendingEndlessUploadCount(): number {
    const row = getDb()
      .prepare(
        'SELECT COUNT(*) AS count FROM levels WHERE uploaded_at IS NULL AND level_number < 0',
      )
      .get() as { count: number };
    return row.count;
  },

  has(levelNumber: number): boolean {
    const row = getDb()
      .prepare('SELECT 1 AS present FROM levels WHERE level_number = ? LIMIT 1')
      .get(levelNumber) as { present: number } | undefined;
    return row !== undefined;
  },

  listAll(): CatalogRow[] {
    const rows = getDb()
      .prepare(
        `SELECT level_number, difficulty, arrow_count, grid_size, generated_at, uploaded_at, shaped
         FROM levels
         ORDER BY CASE WHEN level_number < 0 THEN 1 ELSE 0 END, ABS(level_number)`,
      )
      .all() as Array<{
      level_number: number;
      difficulty: string | null;
      arrow_count: number;
      grid_size: number;
      generated_at: string;
      uploaded_at: string | null;
      shaped: number;
    }>;

    return rows.map(toRow);
  },

  listCampaign(): CatalogRow[] {
    return this.listAll().filter((row) => isCampaignCatalogKey(row.levelNumber));
  },

  listEndless(): CatalogRow[] {
    return this.listAll().filter((row) => isEndlessCatalogKey(row.levelNumber));
  },

  deleteMany(levelNumbers: number[]): number {
    if (levelNumbers.length === 0) return 0;
    const statement = getDb().prepare('DELETE FROM levels WHERE level_number = ?');
    let removed = 0;
    for (const n of levelNumbers) {
      const result = statement.run(n);
      removed += Number(result.changes ?? 0);
    }
    return removed;
  },

  saveFromCloud(level: Level, uploadedAt = new Date().toISOString()): void {
    const levelNumber = catalogKeyFromLevelId(level.id);
    if (!isCampaignCatalogKey(levelNumber)) return;
    getDb()
      .prepare(
        `INSERT INTO levels (
            level_number, payload, difficulty, arrow_count, grid_size, generated_at, uploaded_at, shaped
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(level_number) DO UPDATE SET
            payload = excluded.payload,
            difficulty = excluded.difficulty,
            arrow_count = excluded.arrow_count,
            grid_size = excluded.grid_size,
            generated_at = excluded.generated_at,
            uploaded_at = excluded.uploaded_at,
            shaped = excluded.shaped`,
      )
      .run(
        levelNumber,
        JSON.stringify(level),
        level.metadata.difficulty ?? null,
        level.arrows.length,
        level.grid.rows,
        level.metadata.authoredAt ?? uploadedAt,
        uploadedAt,
        levelUsedImage(level) ? 1 : 0,
      );
  },

  close(): void {
    db?.close();
    db = null;
  },
};
