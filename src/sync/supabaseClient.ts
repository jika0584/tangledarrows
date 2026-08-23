import Constants from 'expo-constants';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

function extraRecord(): Record<string, unknown> {
  const extra = Constants.expoConfig?.extra;
  return extra && typeof extra === 'object' ? (extra as Record<string, unknown>) : {};
}

function readCredential(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return '';
}

/** Public catalog credentials. The anon key is safe in the client; RLS gates writes. */
export function supabaseCredentials(): { url: string; anonKey: string } {
  const extra = extraRecord();
  return {
    url: readCredential(
      process.env.EXPO_PUBLIC_SUPABASE_URL,
      extra.supabaseUrl,
      extra.EXPO_PUBLIC_SUPABASE_URL,
    ),
    anonKey: readCredential(
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      extra.supabaseAnonKey,
      extra.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    ),
  };
}

/** True when the app has credentials to reach the level service. */
export function isSupabaseConfigured(): boolean {
  const { url, anonKey } = supabaseCredentials();
  return url.length > 0 && anonKey.length > 0;
}

/**
 * Lazily creates the Supabase client. Returns null when unconfigured so the
 * app can fall back to procedural levels instead of failing to start.
 */
export function getSupabase(): SupabaseClient | null {
  if (client) return client;
  if (!isSupabaseConfigured()) return null;

  const { url, anonKey } = supabaseCredentials();
  client = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return client;
}
