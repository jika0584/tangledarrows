import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const STORAGE_KEY = 'amaze-escape/settings/v1';

interface SettingsSnapshot {
  /** When false, blocked taps recoil but never cost a life. Off by default. */
  heartsEnabled: boolean;
  darkMode: boolean;
}

interface SettingsState extends SettingsSnapshot {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setHeartsEnabled: (heartsEnabled: boolean) => Promise<void>;
  setDarkMode: (darkMode: boolean) => Promise<void>;
}

const INITIAL: SettingsSnapshot = {
  heartsEnabled: false,
  darkMode: false,
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
}));

async function persist(state: SettingsSnapshot): Promise<void> {
  try {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        heartsEnabled: state.heartsEnabled,
        darkMode: state.darkMode,
      }),
    );
  } catch {
    // In-session toggles still apply if the write fails.
  }
}
