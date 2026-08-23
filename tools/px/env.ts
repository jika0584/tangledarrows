import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function walkForRoot(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'tools', 'px'))) {
      return dir;
    }
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Project root (the folder that contains package.json). */
export function projectRoot(): string {
  if (process.env.PX_ROOT) return process.env.PX_ROOT;

  const starts = [process.cwd()];
  try {
    starts.push(join(dirname(fileURLToPath(import.meta.url)), '../..'));
  } catch {
    // Bundled Electron entry has no stable source path.
  }

  for (const start of starts) {
    const found = walkForRoot(start);
    if (found) return found;
  }
  return process.cwd();
}

/**
 * Loads `.env` into process.env without overwriting values already set.
 * PX is a local tool, so it reads the same file the Expo app uses.
 */
export function loadEnv(): void {
  const envPath = join(projectRoot(), '.env');
  if (!existsSync(envPath)) return;

  for (const raw of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function supabaseUrl(): string {
  return process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
}

/** Service role key — required to write levels. Never ship this in the app. */
export function supabaseServiceRoleKey(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
}

export function supabaseAnonKey(): string {
  return process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';
}

export function supabaseAccessToken(): string {
  return process.env.SUPABASE_ACCESS_TOKEN?.trim() ?? '';
}

/** Writes or updates keys in `.env` and in the current process. */
export function upsertEnv(values: Record<string, string>): string {
  const envPath = join(projectRoot(), '.env');
  let text = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';

  for (const [key, raw] of Object.entries(values)) {
    const value = raw.trim();
    process.env[key] = value;
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    if (pattern.test(text)) text = text.replace(pattern, line);
    else text = `${text.replace(/\s*$/, '')}\n${line}\n`;
  }

  writeFileSync(envPath, text.startsWith('\n') ? text.slice(1) : text, 'utf8');
  return envPath;
}
