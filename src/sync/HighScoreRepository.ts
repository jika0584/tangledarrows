import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabase, isSupabaseConfigured } from './supabaseClient';

const LOCAL_PREFIX = 'amaze-escape/high-scores/v1';
const DEVICE_ID_KEY = 'amaze-escape/device-id/v1';
const CACHE_META_PREFIX = 'amaze-escape/high-scores-meta/v1';
const LEADERBOARD_LIMIT = 10;
const REFRESH_MS = 5 * 60_000;

export interface HighScoreEntry {
  score: number;
  achievedAt: string;
  deviceId?: string;
  isCurrentRun?: boolean;
  isMine?: boolean;
}

export interface HighScoreBoard {
  entries: HighScoreEntry[];
  /** 1-based rank of this device's best score, or null if none. */
  myRank: number | null;
  myBest: number | null;
}

function localKey(levelId: string): string {
  return `${LOCAL_PREFIX}/${levelId}`;
}

function metaKey(levelId: string): string {
  return `${CACHE_META_PREFIX}/${levelId}`;
}

function sortEntries(entries: HighScoreEntry[]): HighScoreEntry[] {
  return [...entries].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.achievedAt.localeCompare(b.achievedAt);
  });
}

export async function getDeviceId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const created = `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    await AsyncStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    return 'local-device';
  }
}

async function readLocal(levelId: string): Promise<HighScoreEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(localKey(levelId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HighScoreEntry[];
    return Array.isArray(parsed) ? sortEntries(parsed).slice(0, LEADERBOARD_LIMIT) : [];
  } catch {
    return [];
  }
}

async function writeLocal(levelId: string, entries: HighScoreEntry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(
      localKey(levelId),
      JSON.stringify(sortEntries(entries).slice(0, LEADERBOARD_LIMIT)),
    );
    await AsyncStorage.setItem(metaKey(levelId), String(Date.now()));
  } catch {
    // Leaderboard still renders from memory if persistence fails.
  }
}

async function lastFetchedAt(levelId: string): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(metaKey(levelId));
    return raw ? Number(raw) || 0 : 0;
  } catch {
    return 0;
  }
}

function annotateMine(
  entries: HighScoreEntry[],
  deviceId: string,
  current?: { score: number; achievedAt: string },
): HighScoreBoard {
  const tagged = entries.map((entry) => ({
    ...entry,
    isMine: entry.deviceId != null && entry.deviceId === deviceId,
    isCurrentRun:
      current != null &&
      entry.score === current.score &&
      entry.achievedAt === current.achievedAt,
  }));

  const myBestEntry = tagged.find((e) => e.isMine) ?? null;
  let myRank: number | null = null;
  let myBest: number | null = null;
  if (myBestEntry) {
    myBest = myBestEntry.score;
    myRank = tagged.findIndex((e) => e.isMine) + 1;
  }

  return { entries: tagged, myRank, myBest };
}

async function fetchRemote(levelId: string): Promise<HighScoreEntry[] | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('level_high_scores')
    .select('player_name, score, achieved_at')
    .eq('level_id', levelId)
    .order('score', { ascending: false })
    .order('achieved_at', { ascending: true })
    .limit(LEADERBOARD_LIMIT);

  if (error || !data) return null;

  return data.map((row) => ({
    score: Number(row.score),
    achievedAt: String(row.achieved_at),
    deviceId: String(row.player_name),
  }));
}

export const HighScoreRepository = {
  async fetch(
    levelId: string,
    options?: { force?: boolean; current?: { score: number; achievedAt: string } },
  ): Promise<HighScoreBoard> {
    const deviceId = await getDeviceId();
    const force = options?.force === true;
    const stale = Date.now() - (await lastFetchedAt(levelId)) > REFRESH_MS;

    if (force || stale) {
      const remote = await fetchRemote(levelId);
      if (remote) {
        await writeLocal(levelId, remote);
        return annotateMine(remote, deviceId, options?.current);
      }
    }

    const local = await readLocal(levelId);
    return annotateMine(local, deviceId, options?.current);
  },

  /** Background refresh used by the 5-minute poller. */
  async refreshIfStale(levelId: string): Promise<void> {
    const stale = Date.now() - (await lastFetchedAt(levelId)) > REFRESH_MS;
    if (!stale) return;
    const remote = await fetchRemote(levelId);
    if (remote) await writeLocal(levelId, remote);
  },

  async submit(levelId: string, score: number): Promise<HighScoreBoard> {
    const deviceId = await getDeviceId();
    const achievedAt = new Date().toISOString();
    const entry: HighScoreEntry = { score, achievedAt, deviceId };

    const local = await readLocal(levelId);
    // Keep only this device's best locally among peers when offline.
    const withoutMine = local.filter((row) => row.deviceId !== deviceId);
    const merged = sortEntries([...withoutMine, entry]).slice(0, LEADERBOARD_LIMIT);
    await writeLocal(levelId, merged);

    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
      // Upsert-ish: insert then re-fetch top 10. Multiple inserts from the
      // same device are fine — the board always shows the best scores.
      const { error } = await supabase.from('level_high_scores').insert({
        level_id: levelId,
        player_name: deviceId,
        score,
        achieved_at: achievedAt,
      });
      if (!error) {
        return this.fetch(levelId, { force: true, current: { score, achievedAt } });
      }
    }

    return annotateMine(merged, deviceId, { score, achievedAt });
  },
};
