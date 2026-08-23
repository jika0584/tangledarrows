/**
 * PX — local campaign generator for Amaze Escape.
 *
 * Generates numbered puzzles into a SQLite catalog, then uploads them to
 * Supabase so the app can download them in batches.
 *
 *   px generate --count 25 --upload
 *   px status
 *   px upload
 */
import {
  FIRST_CURATED_LEVEL,
  LAST_CURATED_LEVEL,
  asciiPreview,
  fillRatio,
  generateCuratedLevel,
  openingCount,
  profileForLevel,
} from '../../src/procedural/CuratedGenerator';
import { Catalog, catalogPath } from './catalog';
import { loadEnv } from './env';
import { describeMissingConfig, isUploadConfigured, uploadLevels } from './upload';

interface Flags {
  command: string;
  from?: number;
  to?: number;
  count?: number;
  replace: boolean;
  upload: boolean;
  preview: boolean;
  fast: boolean;
  quality: boolean;
  help: boolean;
}

async function main(): Promise<void> {
  loadEnv();
  const flags = parseArgs(process.argv.slice(2));

  if (flags.help || flags.command === 'help' || flags.command === '') {
    printHelp();
    return;
  }

  try {
    switch (flags.command) {
      case 'generate':
        await cmdGenerate(flags);
        break;
      case 'upload':
        await cmdUpload(flags);
        break;
      case 'status':
        cmdStatus();
        break;
      default:
        console.error(`Unknown command "${flags.command}". Run px help.`);
        process.exitCode = 1;
    }
  } finally {
    Catalog.close();
  }
}

async function cmdGenerate(flags: Flags): Promise<void> {
  const { from, to } = resolveRange(flags, { generating: true });
  const seedAttempts = flags.fast ? 1 : flags.quality ? 32 : 8;
  const total = to - from + 1;

  console.log(
    `Generating levels ${from}–${to} (${total})  seeds/level=${seedAttempts}` +
      (flags.replace ? '  replace' : ''),
  );

  const generated: number[] = [];
  const skipped: number[] = [];

  for (let n = from; n <= to; n++) {
    if (!flags.replace && Catalog.has(n)) {
      skipped.push(n);
      continue;
    }

    const started = Date.now();
    const level = generateCuratedLevel(n, { seedAttempts });
    Catalog.save(level);
    generated.push(n);

    const profile = profileForLevel(n);
    const fill = (fillRatio(level) * 100).toFixed(0);
    const ms = Date.now() - started;
    console.log(
      `  ${pad(n)}  ${profile.interiorSize}×${profile.interiorSize}  ` +
        `${pad(level.arrows.length, 3)} arrows  fill ${fill}%  ` +
        `open ${pad(openingCount(level), 2)}  ${profile.difficulty.padEnd(6)}  ${ms}ms`,
    );

    if (flags.preview && total <= 5) {
      console.log(asciiPreview(level));
      console.log('');
    }
  }

  if (skipped.length > 0) {
    console.log(`Skipped ${skipped.length} already in the catalog (pass --replace to overwrite).`);
  }

  if (flags.preview && total > 5 && generated.length > 0) {
    const sample = Catalog.get(generated[0]);
    if (sample) {
      console.log(`\nPreview of level ${generated[0]}:`);
      console.log(asciiPreview(sample));
    }
  }

  console.log(`Catalog: ${catalogPath()}`);
  console.log(`Wrote ${generated.length} level(s).`);

  if (flags.upload) {
    if (generated.length === 0 && skipped.length > 0) {
      await pushRange(from, to);
    } else if (generated.length > 0) {
      await pushRange(generated[0], generated[generated.length - 1]);
    }
  }
}

async function cmdUpload(flags: Flags): Promise<void> {
  const { from, to } = resolveRange(flags, { generating: false });
  await pushRange(from, to);
}

function cmdStatus(): void {
  const highest = Catalog.highest();
  const count = Catalog.count();
  const pending = Catalog.pendingUploadCount();

  console.log(`Catalog   ${catalogPath()}`);
  console.log(`Stored    ${count} level(s)`);
  console.log(`Highest   ${highest ?? 'none'}`);
  console.log(`Pending   ${pending} not yet uploaded`);
  console.log(`Upload    ${isUploadConfigured() ? 'configured' : 'not configured (see px help)'}`);

  if (count === 0) return;

  const from = FIRST_CURATED_LEVEL;
  const to = highest ?? from;
  const rows = Catalog.list(from, to);
  const sample = rows.filter((_, i) => i < 8 || i >= rows.length - 3);
  if (sample.length < rows.length) {
    console.log('\nFirst and last catalog rows:');
  } else {
    console.log('\nCatalog:');
  }

  for (const row of sample) {
    const flag = row.uploadedAt ? 'up' : '  ';
    console.log(
      `  ${flag} ${pad(row.levelNumber)}  ${row.gridSize}×${row.gridSize}  ` +
        `${pad(row.arrowCount, 3)} arrows  ${row.difficulty ?? '?'}`,
    );
    if (sample.length < rows.length && row === sample[7]) {
      console.log('  …');
    }
  }
}

async function pushRange(from: number, to: number): Promise<void> {
  if (!isUploadConfigured()) {
    console.error(describeMissingConfig());
    process.exitCode = 1;
    return;
  }

  const rows = Catalog.payloadRange(from, to);
  if (rows.length === 0) {
    console.error(`No catalog levels in ${from}–${to}. Generate first.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Uploading ${rows.length} level(s) ${rows[0].levelNumber}–${rows[rows.length - 1].levelNumber}…`);
  const result = await uploadLevels(rows);
  if (result.error) {
    console.error(result.error);
    process.exitCode = 1;
    return;
  }

  Catalog.markUploaded(rows.map((row) => row.levelNumber));
  console.log(`Uploaded ${result.uploaded} level(s) to Supabase.`);
}

function resolveRange(
  flags: Flags,
  kind: { generating: boolean },
): { from: number; to: number } {
  const from = flags.from ?? nextFrom(kind.generating);
  let to: number;

  if (flags.to !== undefined) {
    to = flags.to;
  } else if (flags.count !== undefined) {
    to = from + flags.count - 1;
  } else if (kind.generating) {
    to = from + 24;
  } else {
    to = Catalog.highest() ?? from;
  }

  if (from < FIRST_CURATED_LEVEL) {
    throw new Error(`Campaign levels start at ${FIRST_CURATED_LEVEL}.`);
  }
  if (to > LAST_CURATED_LEVEL) {
    throw new Error(`Campaign levels stop at ${LAST_CURATED_LEVEL}.`);
  }
  if (to < from) throw new Error(`Invalid range ${from}–${to}.`);
  return { from, to };
}

function nextFrom(generating: boolean): number {
  const highest = Catalog.highestFrom(FIRST_CURATED_LEVEL);
  if (generating) {
    return highest === null ? FIRST_CURATED_LEVEL : highest + 1;
  }
  const rows = Catalog.list(FIRST_CURATED_LEVEL, highest ?? FIRST_CURATED_LEVEL);
  const pending = rows.find((row) => row.uploadedAt === null);
  return pending?.levelNumber ?? FIRST_CURATED_LEVEL;
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = {
    command: argv[0] ?? '',
    replace: false,
    upload: false,
    preview: false,
    fast: false,
    quality: false,
    help: false,
  };

  const rest = flags.command.startsWith('-') ? argv : argv.slice(1);
  if (flags.command.startsWith('-')) flags.command = '';

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const next = (): string => {
      const value = rest[++i];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      return value;
    };

    switch (arg) {
      case '-h':
      case '--help':
        flags.help = true;
        break;
      case '--from':
        flags.from = parsePositive(next(), '--from');
        break;
      case '--to':
        flags.to = parsePositive(next(), '--to');
        break;
      case '--count':
        flags.count = parsePositive(next(), '--count');
        break;
      case '--replace':
        flags.replace = true;
        break;
      case '--upload':
        flags.upload = true;
        break;
      case '--preview':
        flags.preview = true;
        break;
      case '--fast':
        flags.fast = true;
        break;
      case '--quality':
        flags.quality = true;
        break;
      default:
        throw new Error(`Unknown flag ${arg}`);
    }
  }

  return flags;
}

function parsePositive(raw: string, flag: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${flag} needs a positive integer, got "${raw}"`);
  }
  return value;
}

function pad(value: number, width = 4): string {
  return String(value).padStart(width, ' ');
}

function printHelp(): void {
  console.log(`PX — Amaze Escape campaign generator

Generates numbered puzzles into a local SQLite catalog, then uploads them
to Supabase. The app downloads those rows in batches of 25.

Commands
  px generate [--from N] [--count C | --to N] [--upload] [--replace]
  px upload   [--from N] [--to N]
  px status
  px help

Options
  --from N      First level number (default: next unused, or 1)
  --count C     How many levels to produce (default generate: 25)
  --to N        Inclusive end of the range
  --upload      Push the new rows to Supabase after generating
  --replace     Overwrite levels already in the catalog
  --fast        One seed per level
  --quality     32 seeds per level, pick the fullest tight opening
  --preview     Print an ASCII board (all of them if 5 or fewer)

Upload needs these in .env (the service role key stays on this machine):
  EXPO_PUBLIC_SUPABASE_URL=...
  SUPABASE_SERVICE_ROLE_KEY=...

Create the table once with tools/px/schema.sql in the Supabase SQL editor.
`);
}

main().catch((error) => {
  console.error((error as Error).message);
  Catalog.close();
  process.exit(1);
});
