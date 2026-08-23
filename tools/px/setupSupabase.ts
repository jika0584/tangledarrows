import { homedir } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  supabaseAccessToken,
  supabaseAnonKey,
  supabaseServiceRoleKey,
  supabaseUrl,
  upsertEnv,
} from './env';
import { schemaSql, studioStatus, type StudioStatus } from './service';

const API = 'https://api.supabase.com/v1';
const PROJECT_NAME = 'amaze-escape';
const REGION = 'eu-west-1';

export interface SetupResult {
  status: StudioStatus;
  message: string;
  createdProject: boolean;
}

export async function setupSupabase(): Promise<SetupResult> {
  const token = readAccessToken();
  if (!token) {
    return {
      status: studioStatus(),
      createdProject: false,
      message:
        'No Supabase access token found. In the studio, paste your project URL and keys from https://supabase.com/dashboard, or set SUPABASE_ACCESS_TOKEN and try again.',
    };
  }

  const orgs = await api<Array<{ id: string; name: string }>>(token, '/organizations');
  if (!Array.isArray(orgs) || orgs.length === 0) {
    throw new Error('This Supabase account has no organizations.');
  }

  const projects = await api<Array<{ id: string; name: string; region: string; status: string }>>(
    token,
    '/projects',
  );
  const existing =
    projects.find((project) => project.name === PROJECT_NAME) ??
    (projects.length === 1 ? projects[0] : undefined);

  let ref: string;
  let createdProject = false;

  if (existing) {
    ref = existing.id;
    await waitUntilHealthy(token, ref);
  } else {
    const password = randomPassword();
    const created = await api<{ id: string }>(token, '/projects', {
      method: 'POST',
      body: JSON.stringify({
        name: PROJECT_NAME,
        organization_id: orgs[0].id,
        region: REGION,
        db_pass: password,
        plan: 'free',
      }),
    });
    ref = created.id;
    createdProject = true;
    upsertEnv({ SUPABASE_DB_PASSWORD: password });
    await waitUntilHealthy(token, ref);
  }

  const keys = await api<Array<{ name: string; api_key: string }>>(token, `/projects/${ref}/api-keys`);
  const anon = keys.find((key) => key.name === 'anon')?.api_key ?? '';
  const service = keys.find((key) => key.name === 'service_role')?.api_key ?? '';
  const url = `https://${ref}.supabase.co`;

  upsertEnv({
    EXPO_PUBLIC_SUPABASE_URL: url,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: anon,
    SUPABASE_SERVICE_ROLE_KEY: service,
  });

  const sqlError = await runSchema(token, ref);
  const status = studioStatus();
  status.supabase.tableReady = sqlError ? false : true;
  status.supabase.error = sqlError;

  return {
    status,
    createdProject,
    message: sqlError
      ? `Project is connected, but the table could not be created: ${sqlError}`
      : createdProject
        ? `Created Supabase project ${PROJECT_NAME} and the levels table.`
        : `Connected to ${PROJECT_NAME} and ensured the levels table exists.`,
  };
}

export async function applySchemaWithToken(): Promise<{ ok: boolean; error?: string }> {
  const token = readAccessToken();
  const url = supabaseUrl();
  if (!token || !url) return { ok: false, error: 'Need a Supabase access token and project URL.' };
  const ref = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1];
  if (!ref) return { ok: false, error: 'Could not read the project ref from the URL.' };
  const error = await runSchema(token, ref);
  return error ? { ok: false, error } : { ok: true };
}

function readAccessToken(): string {
  const fromEnv = supabaseAccessToken();
  if (fromEnv) return fromEnv;

  const file = join(homedir(), '.supabase', 'access-token');
  if (existsSync(file)) {
    const token = readFileSync(file, 'utf8').trim();
    if (token) return token;
  }
  return '';
}

async function runSchema(token: string, ref: string): Promise<string | undefined> {
  try {
    await api(token, `/projects/${ref}/database/query`, {
      method: 'POST',
      body: JSON.stringify({ query: schemaSql() }),
    });
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
}

async function waitUntilHealthy(token: string, ref: string): Promise<void> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const projects = await api<Array<{ id: string; status: string }>>(token, '/projects');
    const project = projects.find((item) => item.id === ref);
    if (project && /active|healthy/i.test(project.status)) return;
    await sleep(4000);
  }
  throw new Error('Timed out waiting for the Supabase project to become ready.');
}

async function api<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: token,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `${response.status} ${response.statusText}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

function randomPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%';
  let value = '';
  for (let i = 0; i < 24; i++) value += alphabet[Math.floor(Math.random() * alphabet.length)];
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function currentKeysMasked(): { url: string; anonKey: string; serviceRoleKey: string } {
  return {
    url: supabaseUrl(),
    anonKey: supabaseAnonKey(),
    serviceRoleKey: supabaseServiceRoleKey(),
  };
}
