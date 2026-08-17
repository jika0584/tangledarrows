import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const STORAGE_KEY = 'amaze-escape/progress/v1';

export interface ProgressSnapshot {
  /** Highest curated level number the player has cleared. */
  clearedCuratedLevels: number;
  /** Next curated level to serve, or null once curated content is exhausted. */
  currentCuratedLevel: number | null;
  /** 1-based index into the infinite S-level tier. */
  currentSLevelIndex: number;
}

interface ProgressState extends ProgressSnapshot {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  completeLevel: (levelId: string) => Promise<void>;
  /** Called by the sync layer when no further curated levels exist. */
  exhaustCuratedLevels: () => Promise<void>;
  reset: () => Promise<void>;
}

const INITIAL: ProgressSnapshot = {
  clearedCuratedLevels: 0,
  currentCuratedLevel: 1,
  currentSLevelIndex: 1,
};

export const useProgressStore = create<ProgressState>((set, get) => ({
  ...INITIAL,
  hydrated: false,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) set({ ...INITIAL, ...(JSON.parse(raw) as ProgressSnapshot) });
    } catch {
      // Corrupt or missing progress falls back to a fresh start.
    } finally {
      set({ hydrated: true });
    }
  },

  completeLevel: async (levelId: string) => {
    const state = get();

    if (levelId.startsWith('S')) {
      set({ currentSLevelIndex: state.currentSLevelIndex + 1 });
    } else {
      const cleared = parseInt(levelId, 10);
      set({
        clearedCuratedLevels: Math.max(state.clearedCuratedLevels, cleared),
        currentCuratedLevel: cleared + 1,
      });
    }

    await persist(get());
  },

  exhaustCuratedLevels: async () => {
    set({ currentCuratedLevel: null });
    await persist(get());
  },

  reset: async () => {
    set({ ...INITIAL });
    await persist(get());
  },
}));

async function persist(state: ProgressSnapshot): Promise<void> {
  const snapshot: ProgressSnapshot = {
    clearedCuratedLevels: state.clearedCuratedLevels,
    currentCuratedLevel: state.currentCuratedLevel,
    currentSLevelIndex: state.currentSLevelIndex,
  };
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Progress persistence is best-effort; gameplay continues regardless.
  }
}
