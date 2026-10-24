export type ThemeMode = 'light' | 'dark';

export type GeneratorSizeSlot = 0 | 1 | 2 | 3;

/** Defaults shown as Size 1–4 until the user customizes them in Settings. */
export const DEFAULT_GENERATOR_SIZES = [39, 52, 64, 91] as const;

export const MIN_BOARD_SIZE = 24;
export const MAX_BOARD_SIZE = 150;

export interface StudioSettings {
  theme: ThemeMode;
  /** Four presets used by Generate multiple / Generate single size buttons. */
  generatorSizes: [number, number, number, number];
  /** Shared silhouette folder for campaign generate + endless generate/refresh. */
  shapeFolder: string;
  alsoUseSquares: boolean;
}

const STORAGE_KEY = 'px.studioSettings';

export function defaultStudioSettings(): StudioSettings {
  return {
    theme: 'light',
    generatorSizes: [...DEFAULT_GENERATOR_SIZES],
    shapeFolder: '',
    alsoUseSquares: false,
  };
}

export function loadStudioSettings(): StudioSettings {
  const base = defaultStudioSettings();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<StudioSettings>;
    return {
      theme: parsed.theme === 'dark' ? 'dark' : 'light',
      generatorSizes: normalizeGeneratorSizes(parsed.generatorSizes),
      shapeFolder: typeof parsed.shapeFolder === 'string' ? parsed.shapeFolder : '',
      alsoUseSquares: Boolean(parsed.alsoUseSquares),
    };
  } catch {
    return base;
  }
}

export function saveStudioSettings(settings: StudioSettings): void {
  const next: StudioSettings = {
    theme: settings.theme === 'dark' ? 'dark' : 'light',
    generatorSizes: normalizeGeneratorSizes(settings.generatorSizes),
    shapeFolder: typeof settings.shapeFolder === 'string' ? settings.shapeFolder : '',
    alsoUseSquares: Boolean(settings.alsoUseSquares),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  applyTheme(next.theme);
}

export function applyTheme(theme: ThemeMode): void {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
}

/** Unique ascending sizes for the generate size buttons. */
export function sizeButtonList(sizes: readonly number[]): number[] {
  return [...new Set(sizes.filter((size) => isValidBoardSize(size)))].sort((a, b) => a - b);
}

export function isValidBoardSize(size: number): boolean {
  return Number.isInteger(size) && size >= MIN_BOARD_SIZE && size <= MAX_BOARD_SIZE;
}

export function parseBoardSize(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return isValidBoardSize(value) ? value : null;
}

function normalizeGeneratorSizes(raw: unknown): [number, number, number, number] {
  const defaults = [...DEFAULT_GENERATOR_SIZES] as [number, number, number, number];
  if (!Array.isArray(raw)) return defaults;
  const next = defaults.slice() as [number, number, number, number];
  for (let i = 0; i < 4; i++) {
    const value = Number(raw[i]);
    if (isValidBoardSize(value)) next[i] = value;
  }
  return next;
}
