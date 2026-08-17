# Amaze Escape

A premium, ad-free sliding-arrow puzzle game for Android. Tap an arrow head and it
slides in the direction it points until it either escapes the board or collides
with another arrow. Clear every arrow to win.

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

## How collision works

Tapping resolves in `src/game/engine/Collision.ts`. The arrow advances one cell at
a time and every cell of its body must be able to move, so the ray is cast against
the live occupancy of all other arrows currently on the board — not against a
static map. Bent arrows sweep more than one row or column, and all of it is
checked.

If the arrow clears the board it escapes. If anything is in the way it recoils and
costs a heart.

## Level tiers

| Tier | IDs | Source |
|---|---|---|
| Curated | `1`–`9999` | Downloaded from Supabase in batches of 25 |
| Endless | `S1`, `S2`, … | Generated on device, works fully offline |

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
- Two-finger drag to pan, pinch to zoom, double-tap to toggle magnification
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
app/                  Expo Router screens
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
