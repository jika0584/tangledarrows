# Tangled Arrows: handoff

Source: the summary John had Cursor write, saved here on 24 Nov 2026 so every
chat and future session can use it. It is a temporary document. Delete it once
`docs/ARCHITECTURE.md` and `README.md` are up to date.

Sections 1 to 8 are the summary. "Verified on 24 Nov 2026" is an audit of the
working folder on John's PC against that summary. Where they differ, trust the
audit, then the source.

Never put secret values in this file. The GitHub repository is public.

## Verified on 24 Nov 2026

**The uncommitted work is not on GitHub.** After `git fetch`, `master` and
`origin/master` were both `34bd0fd` and there was no other remote branch. A push
sends commits only, and this work was never committed. Everything in section 4
is still present on John's PC:

| Item | On the PC | In git |
|---|---|---|
| `src/levels/catalogKeys.ts` | yes, new | no |
| `src/components/LevelLoadScreen.tsx` | yes, new | no |
| `src/sync/LevelRepository.ts` changes | yes, modified | no |
| `src/sync/LocalCache.ts`, `BatchDownloader.ts` changes | yes, modified | no |
| `app/game.tsx`, `tools/px/endlessIds.ts` changes | yes, modified | no |
| `app/stages.tsx`, `src/sync/useSilentLevelSync.ts` changes | yes, modified (not named in the summary; they complete its count of seven) | no |
| `.cursor/rules/slevel-generator-baseline.mdc` | yes, new | no |
| `Backgrounds/` | yes, 17 files, 296 KB, new | no |

**Checks, run with the uncommitted work in place:**

- `npm run typecheck`: passes.
- `npm run test:levels`: every suite passes, including SLevelGenerator. It takes
  more than 10 minutes on this PC, nearly all in the SLevelGenerator suite.
- No test covers `src/sync` (repository, cache, downloader) or the load screen.
  Nothing has been checked on a phone.

**Differences and additions to the summary:**

- The gap in section 4 is confirmed: `ensureEndlessBatch` is defined and no file
  in `src`, `app` or `tools` calls it.
- The retry button on the load screen cannot currently appear. `getNextLevel`
  always ends in `resolveEndless`, which returns a level and never sets `error`,
  so `game.tsx` never sees a failed load. If SQLite rejects or generation
  throws, nothing catches it and the load screen stays up. (From reading the
  code, not reproduced.)
- An uncached campaign board opened with no network, and with no known catalog
  ceiling, still goes to Endless, and `game.tsx` then calls
  `exhaustCuratedLevels()`. `campaignCatchUp` can bring the player back later.
- Endless generation runs on the JS thread. On this PC, S1 took 2.1 s and S5,
  S20 and S40 took 5 to 6 s each. A phone will probably be slower.
- The latest EAS Android builds are preview APKs from commit `2048b11`, the
  newest started on 19 Aug 2026 (version 1.0.0, version code 1).
- The `preview` channel's latest OTA is "recert", published 28 Oct 2026 from
  commit `34bd0fd`. It went out at 18:43:36 local time, under 4 minutes after the
  last edit to the uncommitted `LevelRepository.ts` (18:40:01). It therefore
  probably contains the uncommitted work, though this was not confirmed by
  inspecting the bundle.
- `expo-updates`, `expo-navigation-bar` and `expo-splash-screen` are not in
  `2048b11`'s dependency list. The newest build does carry a channel and runtime
  version, so it may include files that were not committed at the time.
- `README.md` says levels 1 to 4 are bundled, but `src/levels/samples` is
  empty. Its 130-arrow minimum also differs from the generator rule file
  (`MIN_ARROWS=35`); the generated S1 has 81 arrows.
- `docs/ARCHITECTURE.md` still describes double-tap zoom and lists the settings
  screen as not built.
- `npx eas whoami` on this PC reports `jika0584`.
- The service role key was not found in git history or in the project source
  folders. It is in `.env`, which is gitignored.
- `level_high_scores` accepts inserts from anyone holding the anon key
  (`tools/px/schema.sql`, `with check (true)`), and that key is in this public
  repository. The live Supabase policy was not checked.

## 1. Identity

| | |
|---|---|
| Product name | Tangled Arrows (local folder: Amaze Escape) |
| Repo | https://github.com/jika0584/tangledarrows.git, branch `master` |
| Expo | owner `jika0584`, slug `amaze-escape`, package `com.amazeescape.app` |
| EAS project | `c9fbc851-f5aa-429d-8de9-f522033c2485` |
| Stack | Expo SDK 57, React Native 0.86, TypeScript, Skia, Reanimated, Zustand, expo-sqlite, Supabase |
| Supabase | https://nqcnmhgxcfctsbaeejzl.supabase.co (anon key is already in `app.json` / `eas.json`) |

Commits:

- `2048b11` (17 Aug 2026): initial game
- `cb743eb` (23 Aug 2026): scoring, OTA, PX level studio
- `34bd0fd` (24 Oct 2026): rotation, high scores, stage picker, iPhone-oriented UI

`master` matches `origin/master`. Everything in section 4 was only on the Cursor
machine's disk when the summary was written.

## 2. What the game is

A playable Android-first sliding-arrow puzzle. Tap an arrow head. It snakes off
in the direction it points until it leaves the board or hits something. Clear
every arrow to win. No ads, no purchases. Hearts exist but are off by default (a
blocked tap recoils and paints the arrow red; it does not cost a life unless the
player turns hearts on).

Three level sources:

- **Campaign**: numbered boards 1–9999, authored in the Windows PX studio and
  stored in Supabase `levels`. The phone downloads them in batches of 25 and
  caches them in SQLite.
- **Endless**: S1, S2, … generated on the phone by
  `src/procedural/SLevelGenerator.ts`, then saved locally so Resume does not
  rebuild the same board.
- **Demo ending**: tiny `demo-ending` board, dev-only, for the win overlay.

`docs/ARCHITECTURE.md` and parts of `README.md` are behind the code. Trust the
source. In particular, there is no double-tap zoom (it was removed), and
settings already exist.

## 3. What already works

### Play

- Snake movement, collision, Skia path animation, pan and pinch (zoom up to 9×).
- Ruler toggle. A blocked arrow stays red; its lane turns red only while the
  ruler is on.
- HUD over the board: level label, arrows left, optional hearts.
- Combo banners, encouragement, progress tint at 50% / 33% / 10%, win celebration
  with a score.
- Cloud high scores (`level_high_scores`).
- Landscape rotation (settings and a rotate control). The board is rotated in JS
  via `RotatedStage`.
- Resume an unfinished run (`src/store/runCache.ts`).
- Stage picker: jump to a campaign or endless board. Cleared boards whose cloud
  payload changed show a NEW ribbon.
- If the catalog grows while the player is in Endless, they are sent back to the
  new campaign boards after the current endless run (`campaignCatchUp`).
- Settings: hearts, dark mode, progress tints, landscape, and a dev tap-target
  tuner (head/tail padding).
- Dev-only tools (`SHOW_DEV_TOOLS` in `src/dev/flags.ts`): catalog refresh, skip,
  "Test ending". Hidden in release and preview builds.

### Shipping

- EAS profiles in `eas.json`: `development` and `preview` are APKs; `production`
  is an AAB, Play track `internal`.
- OTA is wired (expo-updates, one channel per profile). The app does not
  auto-check; `useLaunchUpdate` asks on launch in a release binary.
  `runtimeVersion` is `appVersion` (1.0.0), so a JS update only lands on builds
  with that version.
- `npm start` is a dev client (`expo start --dev-client`). Expo Go is
  `npm run start:go`.

### Authoring (PX)

- `npm run px` / `px.cmd`: CLI.
- `npm run px:ui` / `px-ui.cmd`: Electron studio (generate, play with mouse zoom,
  edit arrows, upload).
- Shapes come from monochrome images (dark mark on white). `Backgrounds\` in the
  project root is the local shape folder and is not in git.
- Campaign sizes: 39, 52, 64, 76, 91 (single-level also allows 150). Hard boards
  only.
- PX can also generate endless boards and upload them to the same `levels` table
  under negative `level_number` (S7 ↔ -7). See `tools/px/service.ts`.

## 4. Uncommitted work (the current edge)

Seven modified files, plus new files. Not committed, not pushed when the summary
was written; see the audit above for the current state.

- `src/levels/catalogKeys.ts`: campaign keys are ≥ 1, endless keys are negative.
- `src/components/LevelLoadScreen.tsx`: step labels (connecting, cache, download,
  building, drawing), plus a retry on failure.
- `app/game.tsx`: uses that screen. The overlay stays up until the board has a
  layout (`onDrawn`).
- `src/sync/LevelRepository.ts`: campaign and endless are separate paths. A
  missing campaign board no longer falls through into inventing levels 11, 12, …
  forever. Endless is generated on device, then written to SQLite so Continue is
  instant. The next endless board is prefetched the same way.
- `LocalCache.ts` / `BatchDownloader.ts`: campaign purge ignores negative rows.
  Endless purge keeps the last 2. `highestCachedLevel()` only looks at positive
  numbers, so endless rows cannot inflate the campaign ceiling.
- `tools/px/endlessIds.ts`: re-exports the shared key helpers.
- `.cursor/rules/slevel-generator-baseline.mdc`: generator restore spec (Aug 2026).
- `Backgrounds\`: shape images, untracked.

Gap to know about: `BatchDownloader.ensureEndlessBatch` can download negative keys
from Supabase, but `LevelRepository.resolveEndless` never calls it. The phone
still generates endless boards. PX can upload them; the app does not consume
those uploads yet.

## 5. Generator rules (do not regress)

`.cursor/rules/slevel-generator-baseline.mdc` is the contract for
`SLevelGenerator.ts`:

- No crumbs. Every arrow is at least 5 cells.
- Vein rule only on the core pass.
- Opening: at most 2 arrows free on the first click.
- Fill target about 93–96% depending on quality. Default export uses
  `quality: 'quality'`.
- A full board is impossible: the first arrow needs a lane out.

If someone says "restore the generator", match that rule file, then run
`npx tsx src/procedural/__tests__/SLevelGenerator.test.ts`.

## 6. Not built

- Sound.
- A hint button. `escapableArrowIds` in `WinCondition.ts` is ready for one; the
  ruler is the only hint in the UI.
- Play Store release beyond the internal track config.
- The phone reading PX-uploaded endless boards (the downloader exists; the
  resolver ignores it).

## 7. What another machine needs

Git clone is not enough.

1. `npm install`
2. `.env` from `.env.example`. The app runs offline without it (Supabase URL and
   anon key are also baked into `app.json`). PX upload needs
   `SUPABASE_SERVICE_ROLE_KEY`. That key is only in the local `.env`, which is
   gitignored. Copy it by hand. Do not commit it.
3. `tools/px/data/` is gitignored (local level DB and stored shapes). Copy that
   folder if the studio catalog should come along. Otherwise regenerate and
   re-upload.
4. `Backgrounds\` if shape-from-folder generation should look the same.
5. The Android keystore lives in the Expo account `jika0584`, not in the repo. Use
   the same account for every later update.

## 8. Commands

| Task | Command |
|---|---|
| Checks | `npm run typecheck`, `npm run test:levels` |
| Play (dev client) | `npm run android` |
| Play (Expo Go) | `npm run start:go` |
| Studio | `npm run px:ui` |
| Sideload APK | `npm run build:apk` |
| JS-only update to an installed preview/prod build | `npm run update:preview` or `npm run update:prod` |
