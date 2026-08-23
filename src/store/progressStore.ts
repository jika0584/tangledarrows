import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { campaignCatchUp } from './campaignCatchUp';
import { useCatalogStamp } from './catalogStamp';

/**
 * Bumped when shipped content changes in a way that stored progress could
 * hide. v1 could record curated levels as exhausted after a failed download,
 * which then permanently routed players into Endless.
 */
const STORAGE_KEY = 'amaze-escape/progress/v2';

export interface ProgressSnapshot {
  /** Highest curated level number the player has cleared. */
  clearedCuratedLevels: number;
  /** Next curated level to serve, or null once curated content is exhausted. */
  currentCuratedLevel: number | null;
  /** 1-based index into the infinite S-level tier. */
  currentSLevelIndex: number;
  /**
   * Whether the player opened Endless from the stage picker. Newly uploaded
   * campaign boards still catch them up after the current endless run.
   */
  leftCuratedByChoice: boolean;
}

interface ProgressState extends ProgressSnapshot {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  completeLevel: (levelId: string) => Promise<void>;
  /** Called by the sync layer when no further curated levels exist. */
  exhaustCuratedLevels: () => Promise<void>;
  /**
   * If the cloud catalog grew past what the player has cleared, put them back
   * on those boards — unless an endless run is still in progress.
   */
  catchUpCampaignIfNeeded: (options: { unfinishedEndlessRun: boolean }) => Promise<void>;
  /** Jumps straight to a numbered level, bypassing normal progression. */
  selectCuratedLevel: (levelNumber: number) => Promise<void>;
  /** Jumps straight to an endless board, bypassing normal progression. */
  selectEndlessLevel: (index: number) => Promise<void>;
  reset: () => Promise<void>;
}

const INITIAL: ProgressSnapshot = {
  clearedCuratedLevels: 0,
  currentCuratedLevel: 1,
  currentSLevelIndex: 1,
  leftCuratedByChoice: false,
};

export const useProgressStore = create<ProgressState>((set, get) => ({
  ...INITIAL,
  hydrated: false,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as ProgressSnapshot;
        set({ ...INITIAL, ...stored });
      }
    } catch {
      // Corrupt or missing progress falls back to a fresh start.
    } finally {
      set({ hydrated: true });
    }
  },

  completeLevel: async (levelId: string) => {
    const state = get();

    if (levelId.startsWith('S')) {
      const currentSLevelIndex = state.currentSLevelIndex + 1;
      const catchUp = campaignCatchUp(state, catalogCeiling(), {
        unfinishedEndlessRun: false,
      });
      set({ currentSLevelIndex, ...(catchUp ?? {}) });
    } else {
      const cleared = parseInt(levelId, 10);
      const clearedCuratedLevels = Math.max(state.clearedCuratedLevels, cleared);
      set({
        clearedCuratedLevels,
        // Replaying an earlier board must not rewind the campaign cursor.
        currentCuratedLevel: clearedCuratedLevels + 1,
      });
    }

    await persist(get());
  },

  exhaustCuratedLevels: async () => {
    set({ currentCuratedLevel: null });
    await persist(get());
  },

  catchUpCampaignIfNeeded: async ({ unfinishedEndlessRun }) => {
    const patch = campaignCatchUp(get(), catalogCeiling(), { unfinishedEndlessRun });
    if (!patch) return;
    set(patch);
    await persist(get());
  },

  selectCuratedLevel: async (levelNumber: number) => {
    set({ currentCuratedLevel: levelNumber, leftCuratedByChoice: false });
    await persist(get());
  },

  selectEndlessLevel: async (index: number) => {
    set({
      currentCuratedLevel: null,
      currentSLevelIndex: index,
      leftCuratedByChoice: true,
    });
    await persist(get());
  },

  reset: async () => {
    set({ ...INITIAL });
    await persist(get());
  },
}));

function catalogCeiling(): number {
  return useCatalogStamp.getState().highestCampaign ?? 0;
}

async function persist(state: ProgressSnapshot): Promise<void> {
  const snapshot: ProgressSnapshot = {
    clearedCuratedLevels: state.clearedCuratedLevels,
    currentCuratedLevel: state.currentCuratedLevel,
    currentSLevelIndex: state.currentSLevelIndex,
    leftCuratedByChoice: state.leftCuratedByChoice,
  };
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Progress persistence is best-effort; gameplay continues regardless.
  }
}
