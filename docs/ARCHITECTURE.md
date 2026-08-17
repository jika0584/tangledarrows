# Amaze Escape — Architecture

Status: tech stack, schema, and generator approved. Canvas, gestures, HUD, and
the Supabase sync layer are implemented.

## Stack

| Concern | Choice | Reason |
|---|---|---|
| App shell | Expo (React Native) + TypeScript | One codebase, Android first, iOS later |
| Rendering | React Native Skia | GPU vector paths for multi-segment arrows |
| Animation | Reanimated 3 | Runs on the UI thread; slides never wait on JS |
| Gestures | Gesture Handler | Native-feel pinch, two-finger pan, tap |
| Navigation | Expo Router | File-based routes, deep links to levels |
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

`src/game/engine/Collision.ts::resolveSlide` steps the whole arrow forward one
cell at a time. For each step, every cell of the body is tested against:

1. `CELL_BLOCKER` cells in the matrix
2. The live `OccupancyIndex` of all *other* arrows still on the board

This matters for bent arrows, which sweep several rows or columns simultaneously.
The result is either `escaped` (with a travel distance for the animation) or
`blocked` (with the distance travelled before recoiling, and what blocked it).

An escaping arrow is removed from board state only when its animation finishes,
so it remains a valid obstacle for anything tapped mid-flight.

## Procedural generation

`src/procedural/SLevelGenerator.ts` — reverse-solvable construction.

1. Build the board silhouette (bordered rectangle, or a caller-supplied shape).
2. Pick a random free cell whose forward ray reaches off-board without crossing an
   existing arrow.
3. Grow a polyline backwards from that head. Steps are limited to "away from the
   head" and perpendicular, so a body cell can never sit in its own escape ray.
4. Verify **every** cell of the finished arrow has a clear ray, not just the head.
5. Commit it. It now blocks future placements, which is what creates interlock.
6. Repeat until the target cell density is reached.

Because each arrow was escapable at the moment it was placed, removing them in
reverse placement order always solves the puzzle. That order is stored in
`metadata.solutionOrder` and is verified by the test suite.

Removing an arrow only ever frees space, so escapability is monotone: an arrow
that can escape now can still escape later. Greedy solving is therefore complete,
which `WinCondition.isSolvable` relies on.

### Tuning

| Parameter | Value |
|---|---|
| Interior board size | 10×10 → 30×30, grows with level index |
| Target density | 42% of floor cells occupied |
| Max arrow length | 5 cells |

## Rendering and camera

- `ArrowPath.ts` builds the shaft as a rounded polyline through cell centres and
  the head as a separate triangle, so tips stay crisp at any zoom.
- `Camera.ts` fits the board to the viewport, clamps zoom to 0.6–4×, and clamps
  panning so the board cannot be lost off-screen.
- `GameCanvas.tsx` applies pan and zoom as a single Skia `Group` transform driven
  by shared values, so camera changes never trigger a React re-render.

Pan translation and pinch-focal correction are tracked as **separate** shared
values that are summed at render time. This is what allows pinch and two-finger
pan to run simultaneously without overwriting each other.

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

- Batches are 25 levels; a refill triggers when fewer than 8 remain ahead.
- `onLevelCompleted` purges cached levels behind the player (keeping a 2-level
  replay window) and prefetches the next batch.
- A missing or unreachable Supabase config is not an error: the app falls through
  to the endless tier and stays fully playable offline.

## Not yet built

- Settings screen (colour themes, haptics toggle)
- Hint button (`escapableArrowIds` already backs it)
- Curated level authoring tool
- Sound design
