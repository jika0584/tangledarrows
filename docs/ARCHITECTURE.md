# Amaze Escape — Architecture

Status: tech stack, schema, and generator approved. Canvas, gestures, HUD, and
the Supabase sync layer are implemented.

## Stack

| Concern | Choice | Reason |
|---|---|---|
| App shell | Expo (React Native) + TypeScript | One codebase, Android first, iOS later |
| Rendering | React Native Skia | GPU vector paths for multi-segment arrows |
| Animation | Reanimated 3 | Runs on the UI thread; slides never wait on JS |
| Gestures | Gesture Handler | Native-feel pinch, pan, tap |
| Navigation | Expo Router | File-based routes: menu, board, stage picker |
| Cloud levels | Supabase | Simple batched reads, good TS SDK |
| Local cache | expo-sqlite | Indexed level storage with cheap purging |
| State | Zustand | Small store, no boilerplate |

Flutter/Flame was considered and rejected: it targets sprite game loops, while
this is a grid puzzle that is mostly UI, layout, and tween animation.

## Data model

`src/levels/types.ts` is the source of truth.

A level is a **board silhouette matrix** plus an **array of arrow polylines**. A
flat matrix cannot describe a bendable multi-cell arrow, which is why arrows are
modelled separately.

### Cell semantics

| Value | Name | Behaviour |
|---|---|---|
| `0` | `CELL_FLOOR` | Arrows may rest here |
| `1` | `CELL_OUTSIDE` | Outside the silhouette; arrows pass through on their way off the board |
| `2` | `CELL_BLOCKER` | Stops a slide like another arrow |

`CELL_OUTSIDE` being pass-through is what lets a board have a shape (the key
outline in the reference art) without turning the outline into a cage.

### Arrows

```ts
interface ArrowDefinition {
  id: string;
  cells: GridCell[];   // tail → head, 4-adjacent, 90° turns allowed
  direction: Direction; // slide vector; head is cells[cells.length - 1]
}
```

## Collision

Arrows move like a snake: the head advances along its direction and each
following segment steps into the cell the segment ahead just left. A bent arrow
therefore threads around its own corner rather than sweeping sideways.

Because the body only ever enters cells the arrow already occupied, it cannot
collide with anything. `src/game/engine/Collision.ts::resolveSlide` casts a
single ray from the head against:

1. `CELL_BLOCKER` cells in the matrix
2. The live `OccupancyIndex` of all *other* arrows still on the board

`CELL_OUTSIDE` cells are pass-through — they carve the silhouette without walling
arrows in. The result is either `escaped` (with the travel distance, which
includes the body length so the tail clears too) or `blocked` (with the free
distance before the recoil, and what blocked it).

An escaping arrow is removed from board state only when its animation finishes,
so it remains a valid obstacle for anything tapped mid-flight.

## Procedural generation

`src/procedural/SLevelGenerator.ts` — reverse-solvable construction.

1. Build the board silhouette (bordered rectangle, or a caller-supplied shape).
2. Pick a random free cell whose forward ray reaches off-board without crossing an
   existing arrow.
3. Grow a polyline backwards from that head. Steps are limited to "away from the
   head" and perpendicular, so a body cell can never sit in its own escape ray.
4. Commit it. It now blocks future placements, which is what creates interlock.
5. Repeat until the target density and the minimum arrow count are both met, or
   until no head anywhere still has a clear ray.

Candidate heads are tried deepest-lane-first, which is what keeps the finished
board from opening with dozens of ready moves — see the README for why.

Because each arrow was escapable at the moment it was placed, removing them in
reverse placement order always solves the puzzle. That order is stored in
`metadata.solutionOrder` and is verified by the test suite.

Removing an arrow only ever frees space, so escapability is monotone: an arrow
that can escape now can still escape later. Greedy solving is therefore complete,
which `WinCondition.isSolvable` relies on.

### Tuning

| Parameter | Value |
|---|---|
| Interior board size | 36×36 → 60×60, grows with level index |
| Target density | 78% at placement, packed to ~95% |
| Cheap rim stubs | at most a handful, so the edge is not free clicks |
| Minimum arrows | 130 |
| Max arrow length | 14 cells ordinary, 14–40 for serpents, sweep-fill on the rim |
| Arrows free on the opening move | 10–20% of the board |

## Rendering and camera

- `ArrowPath.ts` gives each arrow one continuous **travel path**: the body through
  its cell centres, extended straight past the board edge. The arrow drawn on
  screen is a fixed-length window trimmed out of that path via Skia's `start` /
  `end` props, and the slide animation is simply that window moving along it.
  Nothing is re-tessellated per frame, and snaking around bends falls out for
  free. The head is a static triangle placed by a transform sampled from the same
  polyline, so tips stay crisp at any zoom.
- `Camera.ts` fits the board to the viewport, clamps zoom to 0.7–9×, and clamps
  panning so the board cannot be lost off-screen.
- `GameCanvas.tsx` applies pan and zoom as a single Skia `Group` transform driven
  by shared values, so camera changes never trigger a React re-render.

Pan translation and pinch-focal correction are tracked as **separate** shared
values that are summed at render time. This is what allows pinch and pan to run
simultaneously without overwriting each other.

## Accessibility

`HitTest.ts` gives arrow heads a tap buffer of
`max(cellSize * 0.75, 24px / zoom)` in board units — as the board shrinks on
screen, the buffer grows to compensate, so the physical target never drops below a
comfortable size. A tap that misses every head falls back to the arrow bodies.

Double-tap toggles between fitted and 2× magnified views for players who find
pinch gestures awkward.

## Sync

```
LevelRepository.getNextLevel()
  ├─ LocalCache.getLevel(n)            cached curated level
  ├─ BatchDownloader.ensureBatch(n)    fetch 25 levels from Supabase
  └─ generateSLevel(index)             offline fallback, always available
```

PX fills the Supabase `levels` table from a machine here. The app only reads it.
Run `npm run px:ui` for the Windows studio (generate, play with mouse zoom, upload).

- Batches are 25 levels; a refill triggers when fewer than 8 remain ahead.
- `onLevelCompleted` purges cached levels behind the player (keeping a 2-level
  replay window) and prefetches the next batch.
- A missing or unreachable Supabase config is not an error: the app falls through
  to the endless tier and stays fully playable offline.

## Campaign generator (PX)

`tools/px` is a local CLI (`px.cmd` / `npm run px`) that authors the numbered
campaign (levels 5–9999) into `tools/px/data/levels.db` and upserts the same
rows into Supabase. The app never generates that tier on-device — it only
downloads batches.

## Not yet built

- Settings screen (colour themes, haptics toggle)
- Hint button (`escapableArrowIds` already backs it)
- Sound design
