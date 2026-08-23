import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'amaze-escape/run/v1';

/**
 * Mid-level snapshot so quitting (menu, app background, process death) can
 * resume the same board instead of starting the puzzle over.
 */
export interface RunCache {
  levelId: string;
  remainingArrowIds: string[];
  lives: number;
  failedArrowIds: string[];
  elapsedMs: number;
  moves: number;
}

export function isResumable(cache: RunCache | null | undefined): cache is RunCache {
  return !!cache && cache.remainingArrowIds.length > 0 && cache.moves > 0;
}

export async function loadRunCache(): Promise<RunCache | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RunCache;
    if (!parsed || typeof parsed.levelId !== 'string') return null;
    if (!Array.isArray(parsed.remainingArrowIds)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveRunCache(cache: RunCache): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Best-effort; a missed save only costs a resume.
  }
}

export async function clearRunCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}
