import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Level } from '../../src/levels/types';
import { projectRoot, supabaseServiceRoleKey, supabaseUrl } from './env';

const UPSERT_CHUNK = 50;

export interface UploadResult {
  uploaded: number;
  error?: string;
}

export function describeMissingConfig(): string {
  const schema = readFileSync(join(projectRoot(), 'tools', 'px', 'schema.sql'), 'utf8');
  return [
    'PX needs Supabase write credentials in `.env`:',
    '',
    '  EXPO_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co',
    '  SUPABASE_SERVICE_ROLE_KEY=your-service-role-key',
    '',
    'The service role key is only for this local tool. Never put it in the app.',
    'Create the table (once) in the Supabase SQL editor:',
    '',
    schema.trim(),
  ].join('\n');
}

export function isUploadConfigured(): boolean {
  return supabaseUrl().length > 0 && supabaseServiceRoleKey().length > 0;
}

/** Writes curated levels to the same `levels` table the app downloads from. */
export async function uploadLevels(
  rows: { levelNumber: number; level: Level }[],
): Promise<UploadResult> {
  if (rows.length === 0) return { uploaded: 0 };
  if (!isUploadConfigured()) return { uploaded: 0, error: describeMissingConfig() };

  const client = createClient(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let uploaded = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK).map((row) => ({
      level_number: row.levelNumber,
      payload: row.level,
    }));

    const { error } = await client.from('levels').upsert(chunk, {
      onConflict: 'level_number',
    });

    if (error) {
      const hint =
        error.message.includes('Could not find') || error.message.includes('schema cache')
          ? `\n\nThe \`levels\` table is missing. Run tools/px/schema.sql in the Supabase SQL editor.`
          : '';
      return { uploaded, error: `${error.message}${hint}` };
    }

    uploaded += chunk.length;
  }

  return { uploaded };
}
