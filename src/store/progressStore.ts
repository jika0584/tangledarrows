import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { campaignCatchUp } from './campaignCatchUp';
import { useCatalogStamp } from './catalogStamp';

/**
 * Bumped when shipped content changes in a way that stored progress could
 * hide. v1 could record curated levels as exhausted after a failed download,
 * which then permanently routed players into Endless.
 */
const STORAGE_KEY = 'amaze-escape/progress/v3';

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
  /**
   * Cleared campaign boards whose cloud payload was replaced since the last
   * clear — shown orange with a NEW ribbon until replayed.
   */
  staleCuratedLevels: number[];
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
  /** Marks previously-cleared boards whose payload was regenerated. */
  markLevelsRegenerated: (levelNumbers: number[]) => Promise<void>;
  isStaleCuratedLevel: (levelNumber: number) => boolean;
  reset: () => Promise<void>;
}

const INITIAL: ProgressSnapshot = {
  clearedCuratedLevels: 0,
  currentCuratedLevel: 1,
  currentSLevelIndex: 1,
  leftCuratedByChoice: false,
  staleCuratedLevels: [],
};

export const useProgressStore = create<ProgressState>((set, get) => ({
  ...INITIAL,
  hydrated: false,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as Partial<ProgressSnapshot>;
        set({
          ...INITIAL,
          ...stored,
          staleCuratedLevels: Array.isArray(stored.staleCuratedLevels)
            ? stored.staleCuratedLevels.filter((n) => Number.isFinite(n) && n >= 1)
            : [],
        });
      } else {
        // One-shot migrate from v2 so players keep their campaign cursor.
        const legacy = await AsyncStorage.getItem('amaze-escape/progress/v2');
        if (legacy) {
          const stored = JSON.parse(legacy) as Partial<ProgressSnapshot>;
          set({
            ...INITIAL,
            ...stored,
            staleCuratedLevels: [],
          });
          await persist(get());
        }
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
      if (Number.isNaN(cleared)) return;

      const clearedCuratedLevels = Math.max(state.clearedCuratedLevels, cleared);
      const next = cleared + 1;
      const ceiling = catalogCeiling();
      // Advance from the board just finished (replay 17 → 18), not the
      // campaign high-water mark. Past the last uploaded board → Endless.
      const currentCuratedLevel =
        ceiling > 0 && next > ceiling ? null : next;

      set({
        clearedCuratedLevels,
        currentCuratedLevel,
        leftCuratedByChoice: currentCuratedLevel === null ? state.leftCuratedByChoice : false,
        staleCuratedLevels: state.staleCuratedLevels.filter((n) => n !== cleared),
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

  markLevelsRegenerated: async (levelNumbers: number[]) => {
    const state = get();
    const stale = new Set(state.staleCuratedLevels);
    let changed = false;
    for (const n of levelNumbers) {
      if (n >= 1 && n <= state.clearedCuratedLevels && !stale.has(n)) {
        stale.add(n);
        changed = true;
      }
    }
    if (!changed) return;
    set({ staleCuratedLevels: [...stale].sort((a, b) => a - b) });
    await persist(get());
  },

  isStaleCuratedLevel: (levelNumber: number) => {
    return get().staleCuratedLevels.includes(levelNumber);
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
    staleCuratedLevels: state.staleCuratedLevels,
  };
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Progress persistence is best-effort; gameplay continues regardless.
  }
}
