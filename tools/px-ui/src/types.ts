export interface CatalogRow {
  levelNumber: number;
  difficulty: string | null;
  arrowCount: number;
  gridSize: number;
  generatedAt: string;
  uploadedAt: string | null;
  shaped: boolean;
}

export interface StudioStatus {
  catalogPath: string;
  stored: number;
  endlessStored: number;
  highest: number | null;
  highestEndless: number | null;
  pending: number;
  pendingEndless: number;
  nextLevel: number;
  nextEndless: number;
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
  storedSize?: number;
  storedSizes?: number[];
  shapeFolder?: string;
  alsoUseSquares?: boolean;
  endless?: boolean;
}

export interface GenerateShapedRequest {
  levelNumber: number;
  name: string;
  difficulty: 'easy' | 'medium' | 'hard';
  quality: 'fast' | 'normal' | 'quality';
  replace: boolean;
  matrix: import('../../../src/levels/types').CellValue[][];
  shapeSource?: string;
  shapeImage?: { fileName: string; bytes: number[] };
}

export interface RegenerateRequest {
  spec: string;
  quality: 'fast' | 'normal' | 'quality';
}

export interface RefreshEndlessRequest {
  quality: 'fast' | 'normal' | 'quality';
  starterCount?: number;
  storedSize?: number;
  storedSizes?: number[];
  shapeFolder?: string;
  alsoUseSquares?: boolean;
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

export interface PxApi {
  status: () => Promise<StudioStatus>;
  probe: () => Promise<StudioStatus>;
  list: () => Promise<CatalogRow[]>;
  getLevel: (levelNumber: number) => Promise<import('../../../src/levels/types').Level | null>;
  schema: () => Promise<string>;
  keys: () => Promise<{ url: string; anonKey: string; serviceRoleKey: string }>;
  generate: (request: GenerateRequest) => Promise<{ generated: number[]; skipped: number[]; cancelled?: 'now' | 'after' }>;
  generateShaped: (request: GenerateShapedRequest) => Promise<import('../../../src/levels/types').Level>;
  regenerate: (request: RegenerateRequest) => Promise<{ generated: number[]; skipped: string[]; cancelled?: 'now' | 'after' }>;
  refreshEndless: (request: RefreshEndlessRequest) => Promise<{ generated: number[]; cancelled?: 'now' | 'after' }>;
  cancelGenerate: (mode: 'now' | 'after') => Promise<void>;
  pickFolder: () => Promise<{ path: string; count: number } | null>;
  listFolder: (path: string) => Promise<{ path: string; count: number }>;
  onProgress: (handler: (progress: GenerateProgress) => void) => () => void;
  deleteLocal: (levelNumbers: number[]) => Promise<number>;
  deleteCloud: (levelNumbers: number[]) => Promise<{ deleted: number; error?: string }>;
  uploadSelected: (levelNumbers: number[]) => Promise<{ uploaded: number; error?: string }>;
  uploadPending: () => Promise<{ uploaded: number; error?: string }>;
  uploadEndlessPending: () => Promise<{ uploaded: number; error?: string }>;
  pull: () => Promise<{ pulled: number; error?: string }>;
  saveConfig: (config: CloudConfig) => Promise<StudioStatus>;
  setup: () => Promise<{ status: StudioStatus; message: string; createdProject: boolean }>;
  saveLevel: (level: import('../../../src/levels/types').Level) => Promise<import('../../../src/levels/types').Level>;
}
