import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const STORAGE_KEY = 'amaze-escape/catalog-stamp/v1';

interface CatalogStampState {
  /** Epoch ms of the last time cached campaign content actually changed. */
  updatedAt: number | null;
  /** Highest numbered campaign board known from cache or the cloud catalog. */
  highestCampaign: number | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  recordUpdate: () => Promise<void>;
  recordHighest: (highest: number | null) => Promise<void>;
}

export const useCatalogStamp = create<CatalogStampState>((set, get) => ({
  updatedAt: null,
  highestCampaign: null,
  hydrated: false,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { updatedAt?: unknown; highestCampaign?: unknown };
        const updatedAt = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : null;
        const highestCampaign =
          typeof parsed.highestCampaign === 'number' ? parsed.highestCampaign : null;
        set({ updatedAt, highestCampaign });
      }
    } catch {
      // Missing stamp just means nothing has been downloaded yet.
    } finally {
      set({ hydrated: true });
    }
  },

  recordUpdate: async () => {
    const updatedAt = Date.now();
    set({ updatedAt });
    await persist(get());
  },

  recordHighest: async (highest) => {
    if (highest == null || highest < 1) return;
    const current = get().highestCampaign ?? 0;
    if (highest <= current) return;
    set({ highestCampaign: highest });
    await persist(get());
  },
}));

async function persist(state: {
  updatedAt: number | null;
  highestCampaign: number | null;
}): Promise<void> {
  try {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        updatedAt: state.updatedAt,
        highestCampaign: state.highestCampaign,
      }),
    );
  } catch {
    // Display still updates in-session even if persistence fails.
  }
}

export function formatCatalogDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
