# Amaze Escape

A premium, ad-free sliding-arrow puzzle game for Android. Tap an arrow head and it
snakes off in the direction it points — body trailing behind the head — until it
either escapes the board or runs into another arrow. Clear every arrow to win.

No ads. No banners. No microtransactions. No score chasing — just three hearts and
the puzzle.

## Stack

- **Expo (React Native) + TypeScript** — single codebase, Android first
- **React Native Skia** — GPU-accelerated vector rendering of arrow polylines
- **Reanimated 3 + Gesture Handler** — UI-thread animation and gestures, so slides
  and pinch-zoom never wait on JavaScript
- **Supabase** — batched delivery of curated levels
- **expo-sqlite** — local level cache that purges itself as you progress
- **Zustand** — small, boring state store for progress

## Getting started

```bash
npm install
cp .env.example .env   # optional: only needed for curated levels
npm run android
```

Without Supabase credentials the game runs entirely offline on procedurally
generated levels, so you can play immediately.

### Scripts

| Command | Purpose |
|---|---|
| `npm run android` | Launch on a device or emulator |
| `npm run typecheck` | TypeScript, no emit |
| `npm run test:levels` | Generator, collision, and solvability checks |
| `npm run px` / `.\px.cmd` | Generate campaign levels locally and upload them to Supabase |
| `npm run px:ui` / `.\px-ui.cmd` | Windows studio: generate, play, and sync levels |
| `npm run build:apk` | EAS cloud build: Android APK you can sideload or share |
| `npm run build:prod` | EAS cloud build: Android App Bundle for the Play Store |

## Shipping an Android build

The project is linked to EAS (`jika0584/amaze-escape`). A downloadable APK is
an EAS **preview** build: a release binary, signed, with a link you can send to
anyone. The **production** profile instead produces an `.aab` for Google Play.

```bash
npx eas login
npm run build:apk
```

When the build finishes, Expo prints a download URL. Open it on the phone (or
scan the QR code) to install. The first Android build will also generate a
keystore and keep it in your Expo account — do not lose that account; the same
key is required for every later update.

Play Store submission, once you have a developer account:

```bash
npm run build:prod
npx eas submit --platform android --profile production
```

## How a level is described

A level is a board silhouette plus a list of arrows. The matrix alone cannot
express a multi-cell, bendable arrow, so arrows are stored as polylines.

```json
{
  "id": "1",
  "source": "curated",
  "version": 1,
  "grid": { "rows": 8, "cols": 8, "matrix": [[1, 1, 1], [1, 0, 1]] },
  "arrows": [
    {
      "id": "a1",
      "cells": [{ "row": 2, "col": 2 }, { "row": 2, "col": 3 }],
      "direction": "right"
    }
  ],
  "metadata": { "arrowCount": 1, "difficulty": "easy" }
}
```

`cells` runs tail to head; the last cell is the tappable head and defines the
escape direction.

### Cell values

| Value | Meaning |
|---|---|
| `0` | Floor. Arrows rest here. |
| `1` | Outside the board silhouette. Arrows slide *through* it on their way off the board. This is how shapes like the key outline are drawn without walling arrows in. |
| `2` | Solid blocker. Stops a slide the same way another arrow does. |

## How movement works

Arrows move like a snake, not like a rigid block. The head advances along the
direction it points, and every other segment follows the path the segment ahead
of it just vacated. A bent arrow threads itself around its own corner and
straightens out as it leaves.

This has a neat consequence for collision: the body only ever moves into cells
the arrow already occupied, so it can never hit anything. The entire outcome is
decided by casting a single ray from the head against the live occupancy of the
other arrows (`src/game/engine/Collision.ts`).

If the ray reaches the edge, the arrow escapes. If anything is in the way it
recoils and costs a heart.

Rendering follows the same idea. Each arrow owns one continuous path — its body,
extended straight past the board edge — and the visible arrow is a fixed-length
window trimmed out of it. Sliding that window along the path *is* the animation,
so Skia handles it on the GPU without rebuilding geometry each frame.

## Level tiers

| Tier | IDs | Source |
|---|---|---|
| Bundled | `1`–`4` | Shipped in the binary, playable offline from a cold install |
| Curated | `5`–`9999` | Downloaded from Supabase in batches of 25 |
| Endless | `S1`, `S2`, … | Generated on device, works fully offline |

Endless boards start at 38×38 with at least 130 arrows and grow with
progression, reaching roughly 450 arrows on a 62×62 board deep into the tier.

Arrow lengths are drawn from three bands — stubby, mid-length, and ordinary
pieces of up to fourteen cells — rather than uniformly. On top of that, a handful of
*serpents* are placed first while the board is empty: 14–40 cells, with a
deliberate walk (a 2-wide lawnmower sweep, zigzag teeth, a same-way coil, or a
turn-heavy meander). Rim heads grow the same way along the edge instead of
poking out as two-cell stubs. They
are sparse on purpose — a few long winding pieces carry the complexity, and the
rest of the board stays readable. The requested length is only an upper intent:
the polyline walk stops early when it runs out of room, which spreads the
distribution further.

Placement alone saturates around 50–70% of the silhouette, because every arrow
needs a clear lane to the edge. A second pass then grows arrow *tails* into the
leftovers, which is free of consequences: arrows snake, so a longer tail follows
the head and never sweeps new ground. A tail may only cross the lane of an arrow
placed *earlier*, since that one leaves after this arrow is already gone.

The binding constraint is the ordering, not the space, so the solve order is
re-derived between growth rounds — a different valid order unlocks cells the
previous one had locked. That lifts endless boards toward 95% fill — leftover cells are almost always
the lanes the first arrows need to leave through, not the big interior holes
from earlier builds. The
bundled boards, which additionally search 240 seeds for the fullest result, stay
very nearly solid.

A third pass then packs leftover holes with longer reverse-solvable arrows
rather than rim stubs. Short arrows that already sit on the edge, pointing off
the board, are capped to a handful — they are free clicks, not puzzle pieces.

A completely full board is impossible by construction: the arrow that leaves
first needs an empty lane to leave through.

### Why the opening position is tight

Filling a board says nothing about how hard it is to start. Reverse construction
hands every arrow a clear lane the moment it is placed, so what decides whether
the finished board is a puzzle or a tap-anything board is how many of those
lanes later arrows happen to fill back in.

Placement therefore prefers heads parked deep in the board over heads a step
from the edge: a long lane gives the remaining arrows somewhere to land, while a
short one tends to stay open forever. That alone cuts the arrows that can escape
on the first move from around 40% of the board to 10–20%, and it packs the board
tighter as a side effect. The bundled levels go further and pick, among the
seeds that fill equally well, the one that opens tightest.

The bundled levels are cut to recognisable silhouettes — a heart, a square, a
donut with a hollow middle, and a triangle whose diagonals are necessarily
stepped by the grid. `npm run gen:levels` regenerates them, printing an ASCII
preview of each and verifying solvability. The donut's hole is pass-through, so
arrows can escape straight across it.

Completed levels are purged from the local cache as you advance, so the install
stays small no matter how far you get. When curated levels run out, the endless
tier takes over without interrupting play.

### Why generated levels are always solvable

The generator builds backwards. It only ever places an arrow whose escape path is
currently clear, and each new arrow becomes an obstacle for the next one.
Removing the arrows in reverse placement order is therefore always a valid
solution, and the generator records that order in `metadata.solutionOrder`.

This also means the puzzle can never deadlock: removing an arrow only frees space,
so an arrow that can escape now can still escape later. Greedy solving is enough,
which is what `isSolvable()` uses to verify levels.

## Accessibility

The primary player has limited patience for fiddly touch targets, and the design
follows from that:

- Arrow heads carry a tap buffer that never shrinks below a comfortable physical
  target, however far the board is zoomed out
- A near miss falls back to the arrow body rather than doing nothing
- Drag to pan, pinch to zoom. Pinch is damped rather than raw, so the zoom is
  steerable instead of twitchy, and it reaches 9× because a 60-wide board fitted
  to a phone leaves cells only a few pixels across. There is deliberately no
  double-tap gesture: it forced every single tap to wait and lose a race
  against it
- The ruler toggle draws a guide line along the axis of every arrow, so a lane
  can be traced across a crowded board. It shows where the lanes are, not which
  ones are clear, so it aids reading without solving the puzzle for you. A
  blocked tap paints that arrow red and, while the ruler is on, paints its
  lane red too. The mark stays until you restart or the arrow later leaves
- High-contrast palette, large type, generous spacing throughout

## Supabase schema

```sql
create table levels (
  level_number int primary key,
  payload jsonb not null
);

alter table levels enable row level security;

create policy "levels are readable" on levels
  for select using (true);
```

## Layout

```
app/
  index.tsx           Main menu
  game.tsx            The board
  stages.tsx          Stage picker — jump to any shaped or endless level
src/
  components/         Canvas, arrow rendering, HUD, overlays
  game/
    engine/           Grid, collision, movement, hit testing, win condition
    rendering/        Skia path builders, camera and zoom math
    hooks/            useBoard — engine to view bridge
  levels/             Schema, parser, sample levels
  procedural/         Endless level generator
  sync/               Supabase client, batch downloader, SQLite cache
  store/              Progress persistence
  theme/              Palette, typography, spacing
```
