import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { PaddingSize, TapZoneSize } from '../game/engine/HitTest';

const STORAGE_KEY = 'amaze-escape/settings/v1';

interface SettingsSnapshot {
  /** When false, blocked taps recoil but never cost a life. Off by default. */
  heartsEnabled: boolean;
  darkMode: boolean;
  /** Remaining-arrow tint milestones at 50% / 33% / 10%. On by default. */
  progressTintsEnabled: boolean;
  /** Board turned a quarter turn in JS, for wide maps. */
  landscapeMode: boolean;
  /** Unlocks tap debug overlays and live padding overrides. */
  devMode: boolean;
  tapZoneSize: TapZoneSize;
  headPadding: PaddingSize;
  tailPadding: PaddingSize;
  showPadding: boolean;
}

interface SettingsState extends SettingsSnapshot {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setHeartsEnabled: (heartsEnabled: boolean) => Promise<void>;
  setDarkMode: (darkMode: boolean) => Promise<void>;
  setProgressTintsEnabled: (progressTintsEnabled: boolean) => Promise<void>;
  setLandscapeMode: (landscapeMode: boolean) => Promise<void>;
  setDevMode: (devMode: boolean) => Promise<void>;
  setTapZoneSize: (tapZoneSize: TapZoneSize) => Promise<void>;
  setHeadPadding: (headPadding: PaddingSize) => Promise<void>;
  setTailPadding: (tailPadding: PaddingSize) => Promise<void>;
  setShowPadding: (showPadding: boolean) => Promise<void>;
}

const INITIAL: SettingsSnapshot = {
  heartsEnabled: false,
  darkMode: false,
  progressTintsEnabled: true,
  landscapeMode: false,
  devMode: false,
  tapZoneSize: 'medium',
  headPadding: 'small',
  tailPadding: 'none',
  showPadding: false,
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...INITIAL,
  hydrated: false,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SettingsSnapshot>;
        set({
          heartsEnabled: parsed.heartsEnabled === true,
          darkMode: parsed.darkMode === true,
          progressTintsEnabled: parsed.progressTintsEnabled !== false,
          landscapeMode: parsed.landscapeMode === true,
          devMode: parsed.devMode === true,
          tapZoneSize: readTapZone(parsed.tapZoneSize),
          headPadding: readPadding(parsed.headPadding, 'small'),
          tailPadding: readPadding(parsed.tailPadding, 'none'),
          showPadding: parsed.showPadding === true,
        });
      }
    } catch {
      // Missing or corrupt settings fall back to the shipped defaults.
    } finally {
      set({ hydrated: true });
    }
  },

  setHeartsEnabled: async (heartsEnabled) => {
    set({ heartsEnabled });
    await persist(get());
  },

  setDarkMode: async (darkMode) => {
    set({ darkMode });
    await persist(get());
  },

  setProgressTintsEnabled: async (progressTintsEnabled) => {
    set({ progressTintsEnabled });
    await persist(get());
  },

  setLandscapeMode: async (landscapeMode) => {
    set({ landscapeMode });
    await persist(get());
  },

  setDevMode: async (devMode) => {
    set({ devMode });
    await persist(get());
  },

  setTapZoneSize: async (tapZoneSize) => {
    set({ tapZoneSize });
    await persist(get());
  },

  setHeadPadding: async (headPadding) => {
    set({ headPadding });
    await persist(get());
  },

  setTailPadding: async (tailPadding) => {
    set({ tailPadding });
    await persist(get());
  },

  setShowPadding: async (showPadding) => {
    set({ showPadding });
    await persist(get());
  },
}));

function readPadding(value: unknown, fallback: PaddingSize): PaddingSize {
  return value === 'none' || value === 'small' || value === 'big' ? value : fallback;
}

function readTapZone(value: unknown): TapZoneSize {
  return value === 'small' || value === 'medium' || value === 'large' ? value : 'medium';
}

async function persist(state: SettingsSnapshot): Promise<void> {
  try {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        heartsEnabled: state.heartsEnabled,
        darkMode: state.darkMode,
        progressTintsEnabled: state.progressTintsEnabled,
        landscapeMode: state.landscapeMode,
        devMode: state.devMode,
        tapZoneSize: state.tapZoneSize,
        headPadding: state.headPadding,
        tailPadding: state.tailPadding,
        showPadding: state.showPadding,
      }),
    );
  } catch {
    // In-session toggles still apply if the write fails.
  }
}
