import { Catalog, CatalogRow, catalogPath } from './catalog';
import {
  FIRST_CURATED_LEVEL,
  LAST_CURATED_LEVEL,
  fillRatio,
  generateCuratedLevel,
  MAX_STORED_BOARD_SIZE,
  MIN_STORED_BOARD_SIZE,
  openingCount,
  profileForBoard,
  profileForLevel,
  storedBoardSize,
} from '../../src/procedural/CuratedGenerator';
import { CELL_FLOOR, Level } from '../../src/levels/types';
import { parseLevel } from '../../src/levels/parser';
import { generateShapedLevel } from '../../src/procedural/ShapedLevelGenerator';
import { matrixFromRaster, type Raster } from '../../src/procedural/shapeFromImage';
import { listImageFiles, pickImageOrSquare } from './shapeFolder';
import { parseLevelSpec } from './levelSpec';
import { findShapeImage, saveShapeBytes, saveShapeFromPath } from './shapeStore';
import {
  beginGeneration,
  endGeneration,
  GenerationHandle,
  isGenerationCancelled,
} from './generationCancel';
import {
  isUploadConfigured,
  uploadLevels,
} from './upload';
import {
  loadEnv,
  projectRoot,
  supabaseAnonKey,
  supabaseServiceRoleKey,
  supabaseUrl,
  upsertEnv,
} from './env';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export interface StudioStatus {
  catalogPath: string;
  stored: number;
  highest: number | null;
  pending: number;
  nextLevel: number;
  supabase: {
    configured: boolean;
    url: string;
    hasServiceRole: boolean;
    hasAnonKey: boolean;
    tableReady: boolean | null;
    error?: string;
  };
}

export interface GenerateRequest {
  from?: number;
  count: number;
  quality: 'fast' | 'normal' | 'quality';
  replace: boolean;
  /** Visible grid for a single board, including the pass-through ring. */
  storedSize?: number;
  /** Allowed board sizes. Each puzzle randomly picks one of these. */
  storedSizes?: number[];
  /** Folder of PNG/JPG silhouettes. Each puzzle randomly picks one. */
  shapeFolder?: string;
  /** When a shape folder is set, also mix in plain square boards. */
  alsoUseSquares?: boolean;
}

export type RasterFromPath = (filePath: string) => Raster;

export interface GenerateShapedRequest {
  levelNumber: number;
  name: string;
  difficulty: 'easy' | 'medium' | 'hard';
  quality: 'fast' | 'normal' | 'quality';
  replace: boolean;
  matrix: import('../../src/levels/types').CellValue[][];
  /** Image filename, when the matrix came from a picture. */
  shapeSource?: string;
  /** Original image bytes so the silhouette can be regenerated later. */
  shapeImage?: { fileName: string; bytes: number[] };
}

export interface RegenerateRequest {
  spec: string;
  quality: 'fast' | 'normal' | 'quality';
}

export interface GenerateProgress {
  current: number;
  total: number;
  levelNumber: number;
  arrows: number;
  fill: number;
  openings: number;
  difficulty: string;
}

export interface CloudConfig {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

const PULL_PAGE = 200;

export function studioStatus(): StudioStatus {
  loadEnv();
  const highest = Catalog.highest();
  const highestCampaign = Catalog.highestFrom(FIRST_CURATED_LEVEL);
  return {
    catalogPath: catalogPath(),
    stored: Catalog.count(),
    highest,
    pending: Catalog.pendingUploadCount(),
    nextLevel:
      highestCampaign === null
        ? FIRST_CURATED_LEVEL
        : Math.min(LAST_CURATED_LEVEL, highestCampaign + 1),
    supabase: {
      configured: isUploadConfigured(),
      url: supabaseUrl(),
      hasServiceRole: supabaseServiceRoleKey().length > 0,
      hasAnonKey: supabaseAnonKey().length > 0,
      tableReady: null,
    },
  };
}

export async function probeSupabase(): Promise<StudioStatus> {
  const status = studioStatus();
  if (!isUploadConfigured()) return status;

  const client = adminClient();
  const { error } = await client.from('levels').select('level_number').limit(1);
  if (error) {
    status.supabase.tableReady = false;
    status.supabase.error = error.message;
  } else {
    status.supabase.tableReady = true;
  }
  return status;
}

export function listCatalog(): CatalogRow[] {
  return Catalog.listAll();
}

export function getCatalogLevel(levelNumber: number): Level | null {
  return Catalog.get(levelNumber);
}

export async function generateRange(
  request: GenerateRequest,
  onProgress?: (progress: GenerateProgress) => void,
  rasterFromPath?: RasterFromPath,
): Promise<{ generated: number[]; skipped: number[]; cancelled?: 'now' | 'after' }> {
  const handle = beginGeneration();
  try {
    return await generateRangeWithHandle(request, onProgress, rasterFromPath, handle);
  } finally {
    endGeneration(handle);
  }
}

async function generateRangeWithHandle(
  request: GenerateRequest,
  onProgress: ((progress: GenerateProgress) => void) | undefined,
  rasterFromPath: RasterFromPath | undefined,
  handle: GenerationHandle,
): Promise<{ generated: number[]; skipped: number[]; cancelled?: 'now' | 'after' }> {
  const highestCampaign = Catalog.highestFrom(FIRST_CURATED_LEVEL);
  const from = request.from ?? (highestCampaign === null ? FIRST_CURATED_LEVEL : highestCampaign + 1);
  if (from < FIRST_CURATED_LEVEL || from > LAST_CURATED_LEVEL) {
    throw new Error(`Levels run ${FIRST_CURATED_LEVEL}–${LAST_CURATED_LEVEL}.`);
  }
  const to = Math.min(LAST_CURATED_LEVEL, from + Math.max(1, request.count) - 1);
  const seedAttempts = request.quality === 'fast' ? 1 : request.quality === 'quality' ? 32 : 8;
  const generated: number[] = [];
  const skipped: number[] = [];
  const total = to - from + 1;
  const images = request.shapeFolder ? listImageFiles(request.shapeFolder) : [];
  const alsoUseSquares = Boolean(request.alsoUseSquares);

  if (request.shapeFolder) {
    if (!rasterFromPath) {
      throw new Error('Reading a shape folder needs the PX window.');
    }
    if (images.length === 0 && !alsoUseSquares) {
      throw new Error('That folder has no images. Add PNG/JPG files, or tick “also use squares”.');
    }
  }

  onProgress?.({
    current: 0,
    total,
    levelNumber: from,
    arrows: 0,
    fill: 0,
    openings: 0,
    difficulty: profileForLevel(from).difficulty,
  });

  for (let n = from; n <= to; n++) {
    try {
      handle.throwIfNow();
    } catch (error) {
      if (isGenerationCancelled(error)) {
        return { generated, skipped, cancelled: error.mode };
      }
      throw error;
    }

    if (!request.replace && Catalog.has(n)) {
      skipped.push(n);
      onProgress?.({
        current: generated.length + skipped.length,
        total,
        levelNumber: n,
        arrows: 0,
        fill: 0,
        openings: 0,
        difficulty: profileForLevel(n).difficulty,
      });
      continue;
    }

    const storedSize = pickStoredSize(n, request);
    const imagePath = request.shapeFolder ? pickImageOrSquare(images, alsoUseSquares) : null;
    let level: Level;
    try {
      level =
        imagePath && rasterFromPath
          ? await generateFromImage(
              n,
              imagePath,
              seedAttempts,
              rasterFromPath,
              images,
              alsoUseSquares,
              storedSize,
              handle,
            )
          : generateCuratedLevel(n, { seedAttempts, storedSize });
    } catch (error) {
      if (isGenerationCancelled(error)) {
        return { generated, skipped, cancelled: error.mode };
      }
      throw error;
    }
    Catalog.save(level);
    generated.push(n);

    onProgress?.({
      current: generated.length + skipped.length,
      total,
      levelNumber: n,
      arrows: level.arrows.length,
      fill: fillRatio(level),
      openings: openingCount(level),
      difficulty: profileForLevel(n).difficulty,
    });

    await yieldEventLoop();
    if (handle.stopAfterCurrent()) {
      return { generated, skipped, cancelled: handle.mode === 'now' ? 'now' : 'after' };
    }
  }

  return { generated, skipped };
}

function allowedStoredSizes(request: GenerateRequest): number[] {
  const raw = request.storedSizes?.length
    ? request.storedSizes
    : request.storedSize != null
      ? [request.storedSize]
      : [];
  return raw.filter(
    (size) =>
      Number.isInteger(size) && size >= MIN_STORED_BOARD_SIZE && size <= MAX_STORED_BOARD_SIZE,
  );
}

function pickStoredSize(levelNumber: number, request: GenerateRequest): number {
  const sizes = allowedStoredSizes(request);
  if (sizes.length === 0) return storedBoardSize(levelNumber);
  return sizes[Math.floor(Math.random() * sizes.length)]!;
}

async function generateFromImage(
  levelNumber: number,
  imagePath: string,
  seedAttempts: number,
  rasterFromPath: RasterFromPath,
  images: string[],
  alsoUseSquares: boolean,
  storedSize: number,
  handle?: GenerationHandle,
): Promise<Level> {
  const tried = new Set<string>();
  let next = imagePath;
  let lastError: unknown;

  for (let attempt = 0; attempt < Math.max(1, Math.min(4, images.length)); attempt++) {
    handle?.throwIfNow();
    tried.add(next);
    try {
      const raster = rasterFromPath(next);
      const matrix = matrixFromRaster(raster, storedSize);
      const profile = profileForBoard(levelNumber, matrix.length);
      const floor = matrix.flat().filter((cell) => cell === CELL_FLOOR).length;
      const interior = Math.max(1, (matrix.length - 2) * (matrix.length - 2));
      const rectangular = floor >= interior * 0.95;
      const shapeSource = basename(next);

      const level = await generateShapedLevel({
        levelNumber,
        name: `Level ${levelNumber}`,
        difficulty: 'hard',
        matrix,
        seedAttempts,
        targetDensity: profile.targetDensity,
        maxArrowLength: profile.maxArrowLength,
        maxTailLength: profile.maxTailLength,
        minArrows: rectangular ? profile.minArrows : undefined,
        checkCancel: () => handle?.throwIfNow(),
        onAttempt: async () => {
          await yieldEventLoop();
          handle?.throwIfNow();
        },
      });

      saveShapeFromPath(levelNumber, next);
      return {
        ...level,
        metadata: {
          ...level.metadata,
          shapeSource,
        },
      };
    } catch (caught) {
      if (isGenerationCancelled(caught)) throw caught;
      lastError = caught;
      const remaining = images.filter((file) => !tried.has(file));
      if (remaining.length === 0) break;
      next = remaining[Math.floor(Math.random() * remaining.length)];
    }
  }

  if (alsoUseSquares) {
    return generateCuratedLevel(levelNumber, { seedAttempts, storedSize });
  }
  throw lastError instanceof Error ? lastError : new Error('Could not build a puzzle from that folder.');
}

function seedAttemptsFor(quality: GenerateRequest['quality']): number {
  if (quality === 'fast') return 8;
  if (quality === 'quality') return 48;
  return 24;
}

export async function generateShaped(
  request: GenerateShapedRequest,
  onProgress?: (progress: GenerateProgress) => void,
  control?: GenerationHandle,
): Promise<Level> {
  const owned = !control;
  const handle = control ?? beginGeneration();
  try {
    return await generateShapedWithHandle(request, onProgress, handle);
  } finally {
    if (owned) endGeneration(handle);
  }
}

async function generateShapedWithHandle(
  request: GenerateShapedRequest,
  onProgress: ((progress: GenerateProgress) => void) | undefined,
  handle: GenerationHandle,
): Promise<Level> {
  if (!request.replace && Catalog.has(request.levelNumber)) {
    throw new Error(`Level ${request.levelNumber} already exists. Tick overwrite to replace it.`);
  }

  const attempts = seedAttemptsFor(request.quality);
  const campaign = request.levelNumber >= FIRST_CURATED_LEVEL;
  const storedSize = request.matrix.length;
  const profile = campaign ? profileForBoard(request.levelNumber, storedSize) : null;
  const difficulty = campaign ? 'hard' : request.difficulty;
  const name = request.name.trim() || `Level ${request.levelNumber}`;
  const floor = request.matrix.flat().filter((cell) => cell === CELL_FLOOR).length;
  const interior = Math.max(1, (storedSize - 2) * (storedSize - 2));
  const rectangular = floor >= interior * 0.95;

  onProgress?.({
    current: 0,
    total: attempts,
    levelNumber: request.levelNumber,
    arrows: 0,
    fill: 0,
    openings: 0,
    difficulty,
  });

  const generated = await generateShapedLevel({
    levelNumber: request.levelNumber,
    name,
    difficulty,
    matrix: request.matrix,
    seedAttempts: attempts,
    targetDensity: profile?.targetDensity,
    maxArrowLength: profile?.maxArrowLength,
    maxTailLength: profile?.maxTailLength,
    minArrows: rectangular ? profile?.minArrows : undefined,
    checkCancel: () => handle.throwIfNow(),
    onAttempt: async ({ current, total, best }) => {
      onProgress?.({
        current,
        total,
        levelNumber: request.levelNumber,
        arrows: best?.arrows.length ?? 0,
        fill: best ? fillRatio(best) : 0,
        openings: best ? openingCount(best) : 0,
        difficulty,
      });
      await yieldEventLoop();
      handle.throwIfNow();
    },
  });

  const level = request.shapeSource
    ? {
        ...generated,
        metadata: {
          ...generated.metadata,
          shapeSource: request.shapeSource,
        },
      }
    : generated;

  Catalog.save(level);
  if (request.shapeImage && request.shapeImage.bytes.length > 0) {
    saveShapeBytes(
      request.levelNumber,
      request.shapeImage.fileName || request.shapeSource || 'shape.png',
      Uint8Array.from(request.shapeImage.bytes),
    );
  }
  return level;
}

export async function regenerateRange(
  request: RegenerateRequest,
  onProgress?: (progress: GenerateProgress) => void,
  rasterFromPath?: RasterFromPath,
): Promise<{ generated: number[]; skipped: string[]; cancelled?: 'now' | 'after' }> {
  const handle = beginGeneration();
  try {
    return await regenerateRangeWithHandle(request, onProgress, rasterFromPath, handle);
  } finally {
    endGeneration(handle);
  }
}

async function regenerateRangeWithHandle(
  request: RegenerateRequest,
  onProgress: ((progress: GenerateProgress) => void) | undefined,
  rasterFromPath: RasterFromPath | undefined,
  handle: GenerationHandle,
): Promise<{ generated: number[]; skipped: string[]; cancelled?: 'now' | 'after' }> {
  if (!rasterFromPath) {
    throw new Error('Image loading is not available in this session.');
  }
  const numbers = parseLevelSpec(request.spec);
  const generated: number[] = [];
  const skipped: string[] = [];

  for (let index = 0; index < numbers.length; index++) {
    try {
      handle.throwIfNow();
    } catch (error) {
      if (isGenerationCancelled(error)) {
        return { generated, skipped, cancelled: error.mode };
      }
      throw error;
    }

    const levelNumber = numbers[index];
    const existing = Catalog.get(levelNumber);
    if (!existing) {
      skipped.push(`${levelNumber} (missing)`);
      continue;
    }
    const imagePath = findShapeImage(levelNumber, existing.metadata.shapeSource);
    if (!imagePath) {
      skipped.push(`${levelNumber} (no image)`);
      continue;
    }

    onProgress?.({
      current: index,
      total: numbers.length,
      levelNumber,
      arrows: existing.arrows.length,
      fill: fillRatio(existing),
      openings: openingCount(existing),
      difficulty: existing.metadata.difficulty ?? 'hard',
    });

    const storedSize = existing.grid.rows;
    const raster = rasterFromPath(imagePath);
    const matrix = matrixFromRaster(raster, storedSize);
    const name = existing.metadata.name?.trim() || `Level ${levelNumber}`;
    let rebuilt: Level;
    try {
      rebuilt = await generateShaped(
        {
          levelNumber,
          name,
          difficulty: existing.metadata.difficulty ?? 'hard',
          quality: request.quality,
          replace: true,
          matrix,
          shapeSource: existing.metadata.shapeSource || basename(imagePath),
        },
        (progress) => {
          onProgress?.({
            current: index,
            total: numbers.length,
            levelNumber,
            arrows: progress.arrows,
            fill: progress.fill,
            openings: progress.openings,
            difficulty: progress.difficulty,
          });
        },
        handle,
      );
    } catch (error) {
      if (isGenerationCancelled(error)) {
        return { generated, skipped, cancelled: error.mode };
      }
      throw error;
    }
    saveShapeFromPath(levelNumber, imagePath);
    generated.push(levelNumber);
    onProgress?.({
      current: index + 1,
      total: numbers.length,
      levelNumber,
      arrows: rebuilt.arrows.length,
      fill: fillRatio(rebuilt),
      openings: openingCount(rebuilt),
      difficulty: rebuilt.metadata.difficulty ?? 'hard',
    });
    await yieldEventLoop();
    if (handle.stopAfterCurrent()) {
      return { generated, skipped, cancelled: handle.mode === 'now' ? 'now' : 'after' };
    }
  }

  return { generated, skipped };
}

export { requestGenerationCancel } from './generationCancel';

export function deleteLocal(levelNumbers: number[]): number {
  return Catalog.deleteMany(levelNumbers);
}

export function saveCatalogLevel(level: Level): Level {
  const parsed = parseLevel(level);
  Catalog.save(parsed);
  return parsed;
}

export async function uploadSelected(levelNumbers: number[]): Promise<{ uploaded: number; error?: string }> {
  if (levelNumbers.length === 0) return { uploaded: 0 };
  const rows = levelNumbers
    .sort((a, b) => a - b)
    .map((n) => {
      const level = Catalog.get(n);
      return level ? { levelNumber: n, level } : null;
    })
    .filter((row): row is { levelNumber: number; level: Level } => row !== null);

  const result = await uploadLevels(rows);
  if (!result.error) Catalog.markUploaded(rows.map((row) => row.levelNumber));
  return result;
}

export async function uploadPending(): Promise<{ uploaded: number; error?: string }> {
  const pending = Catalog.listAll()
    .filter((row) => row.uploadedAt === null && row.levelNumber >= FIRST_CURATED_LEVEL)
    .map((row) => row.levelNumber);
  return uploadSelected(pending);
}

export async function pullFromCloud(): Promise<{ pulled: number; error?: string }> {
  if (!isUploadConfigured()) return { pulled: 0, error: 'Supabase is not configured.' };

  const client = adminClient();
  let pulled = 0;
  let from = 0;

  for (;;) {
    const { data, error } = await client
      .from('levels')
      .select('level_number, payload')
      .order('level_number', { ascending: true })
      .range(from, from + PULL_PAGE - 1);

    if (error) return { pulled, error: error.message };
    if (!data || data.length === 0) break;

    for (const row of data as Array<{ level_number: number; payload: unknown }>) {
      try {
        const raw =
          typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
        const level = parseLevel({ ...(raw as object), id: String(row.level_number), source: 'curated' });
        Catalog.saveFromCloud(level);
        pulled++;
      } catch {
        continue;
      }
    }

    if (data.length < PULL_PAGE) break;
    from += PULL_PAGE;
  }

  return { pulled };
}

export async function deleteCloud(levelNumbers: number[]): Promise<{ deleted: number; error?: string }> {
  if (levelNumbers.length === 0) return { deleted: 0 };
  if (!isUploadConfigured()) return { deleted: 0, error: 'Supabase is not configured.' };

  const client = adminClient();
  const { error } = await client.from('levels').delete().in('level_number', levelNumbers);
  if (error) return { deleted: 0, error: error.message };
  return { deleted: levelNumbers.length };
}

export function saveCloudConfig(config: CloudConfig): StudioStatus {
  upsertEnv({
    EXPO_PUBLIC_SUPABASE_URL: config.url.replace(/\/$/, ''),
    EXPO_PUBLIC_SUPABASE_ANON_KEY: config.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey,
  });
  return studioStatus();
}

export function schemaSql(): string {
  return readFileSync(join(projectRoot(), 'tools', 'px', 'schema.sql'), 'utf8');
}

function adminClient() {
  return createClient(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
