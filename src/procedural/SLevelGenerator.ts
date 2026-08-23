import {
  ALL_DIRECTIONS,
  ArrowDefinition,
  CELL_BLOCKER,
  CELL_FLOOR,
  CELL_OUTSIDE,
  CellValue,
  Difficulty,
  Direction,
  DIRECTION_DELTA,
  GridCell,
  Level,
  LevelGrid,
  formatSLevelId,
} from '../levels/types';
import { SeededRandom } from './SeededRandom';

export interface SLevelGeneratorOptions {
  /** 1-based S-level index (S1, S2, …). Also the default seed. */
  sLevelIndex: number;
  /** Override seed for testing / regeneration. */
  seed?: number;
  /** Interior playable size before boundary walls. Defaults to a size that scales with index. */
  gridSize?: number;
  /**
   * Fraction of floor cells that should end up covered by arrow bodies.
   * S-levels default high to keep difficulty at "Hard".
   */
  targetDensity?: number;
  /** Max polyline length per arrow (including head) during initial placement. */
  maxArrowLength?: number;
  /** Max length an arrow may reach once tails are grown into leftover cells. */
  maxTailLength?: number;
  /**
   * Optional custom board silhouette (1 = outside/wall, 0 = floor).
   * When supplied, `gridSize` is ignored and this matrix defines the board.
   */
  shapeMatrix?: CellValue[][];
  /**
   * Keep placing until at least this many arrows exist, even after the density
   * target is met. Defaults to 35 on the endless boards and 0 on silhouettes.
   */
  minArrows?: number;
  /**
   * Ignore the level index / explicit seed and mix in fresh entropy so two
   * regenerations of the same S-number are different layouts.
   */
  forceRandomize?: boolean;
  /**
   * Extra salt mixed into the seed. Same index + same salt is reproducible;
   * omit with `forceRandomize` to use the clock / CSPRNG.
   */
  randomSalt?: number;
}

interface OccupancyGrid {
  rows: number;
  cols: number;
  /** null = empty, string = id of the arrow occupying the cell */
  cells: (string | null)[][];
}

interface HeadCandidate {
  cell: GridCell;
  lane: number;
  /** True when this head already sits on an earlier arrow's escape ray. */
  blocks: boolean;
}

/** Incremental pool of empty floor cells sitting on some arrow's escape ray. */
interface RayCache {
  byId: Map<string, { cellSet: Set<string>; live: boolean; direction: Direction }>;
  /** Arrow ids whose ray still has at least one empty floor cell. */
  unblocked: string[];
  /** Empty ray cell → arrow ids that currently claim it. */
  cellToIds: Map<string, Set<string>>;
}

const MIN_INTERIOR = 36;
const MAX_INTERIOR = 60;

const DEFAULT_S_DENSITY = 0.95;
const FILL_TARGET = 0.99;
/** Hole-packing keeps placing long snakes until the board is almost solid. */
const PACK_TARGET = FILL_TARGET;
/** Main reverse-construction must reach this before pink fillers take over. */
const CORE_COVERAGE = 0.95;
/** Immediately clickable arrows allowed at solve step 1. */
const MAX_OPENING_MOVES = 2;

/** Grow until trapped or this length. Raised so blockers can reach across the board. */
const DEFAULT_MAX_ARROW_LENGTH = 36;

/** Tails may keep eating leftover cells after placement. */
const DEFAULT_MAX_TAIL_LENGTH = 80;

/** Main-pass arrows shorter than this are rejected and another head is tried. */
const DEFAULT_MIN_ARROW_LENGTH = 6;

/**
 * A head this close to the exit (outside ring or board edge) is a free click.
 * Lane 2 = sitting on the rim pointing out; lane 3 = one floor cell in front.
 */
const CHEAP_EXIT_LANE = 3;

/** First arrow (leaves last) gets extra room so later pieces can nest into it. */
const FIRST_ARROW_MIN = 12;

const MIN_ARROWS = 35;

const CORE_SATURATION_RETRIES = 40;
const FILLER_QUICK_ATTEMPTS = 16;
const FILLER_LONG_MIN = 6;
const FILLER_LONG_MAX = 12;
const FILLER_RELAX_MIN = 4;

/** 2-cell crumbs only, and only in pockets smaller than 3 cells. */
const GAP_FILL_MAX_LENGTH = 2;
const CRUMB_POCKET_MAX = 2;

/** Longest snake a pocket puzzle will try to grow. */
const POCKET_SNAKE_MAX = 20;

/** Tail growth still refuses to keep a long stripe. */
const STRAIGHT_CAP_MAX = 5;

/** After a turn, force this many straight steps before another turn is legal. */
const TURN_COOLDOWN_MIN = 1;
const TURN_COOLDOWN_MAX = 5;

/** Tight traps mixed in with coiling meanders. */
const SNAKE_MIN_CAP = 6;
const SNAKE_LONG_CAP = 64;

/** Bounce new heads away from this many most-recently placed heads. */
const SCATTER_RECENT = 3;
const SCATTER_DIST_PRIMARY = 5;
const SCATTER_DIST_FALLBACK = 3;

/** 2×2 quadrants; a quadrant stays banned for this many following heads. */
const ZONE_DIVISIONS = 2;
const ZONE_BAN_PLACEMENTS = 2;

/** A quadrant may not put more than this share of heads on one escape direction. */
const DIR_QUOTA = 0.3;
/** Do not enforce the quota until the quadrant has this many arrows. */
const DIR_QUOTA_MIN = 5;
/** Same-direction parallel adjacency (unzipping / spooning). */
const SPOON_PENALTY = 800;

/** Manhattan improvement toward the hunted ray, per cell closer. */
const MAGNET_PER_CELL = 80;
/** Extra pull once the primary ray is covered and the tail hunts another. */
const MAGNET_AFTER_PRIMARY = 95;
/** Weaker pull toward a second ray while still closing on the primary. */
const BONUS_CLIP_PULL = 34;
/** Landing on the primary target ray (prefer a perpendicular cross). */
const PRIMARY_CROSS = 155;
/** Crossing an extra unblocked ray — master-key / dependency branch. */
const MULTI_RAY_CROSS = 260;
/** Mild pull through the middle 50% of the board (spaghetti knot). */
const CENTER_BIAS = 22;
/** Let a magnet turn beat the post-turn straight cooldown. */
const HUNT_TURN_MARGIN = 40;
/** Hunters closer than this sit on the target instead of crossing the map. */
const HUNT_MIN_GAP = 6;
/** Reserve this many cells after the primary hit for extra ray hooks. */
const HUNT_BRANCH_RESERVE = 8;

interface RayHunt {
  primary: Set<string>;
  primaryCells: GridCell[];
  bonus: Set<string>;
  focusAxis: 'h' | 'v' | null;
  centerRow0: number;
  centerRow1: number;
  centerCol0: number;
  centerCol1: number;
}

/**
 * Reverse-solvable S-level generator.
 *
 * Arrows are placed last-to-leave first. Each new polyline is a meandering
 * walk that grows until it is trapped or hits the length cap: after every turn
 * it locks straight for 1–5 cells, so boards mix staircases with longer
 * parallel runs. New heads are banned from the last head's quadrant for the
 * next two placements, so consecutive pieces jump to another quadrant. Target
 * rays are the oldest perpendicular unblocked escape (then a random
 * perpendicular, then any) so a new piece crosses traffic instead of
 * stacking a same-direction jam. Bodies refuse to run alongside a neighbour
 * that shares the same escape direction (anti-spoon). Each quadrant bans an
 * escape heading that already holds more than 30% of its heads, so fillers
 * cannot spam the nearest border. Scattered heads hunt the chosen ray across
 * the board, then keep growing to clip extra rays so one piece can lock
 * several paths. Tails prefer the middle of
 * the silhouette, so bodies knot in the centre instead of hugging the rim.
 * One forward pass builds the board; leftover holes are packed with long
 * fillers, then short plugs once density is past 95% or several attempts
 * miss. At most two arrows may be free on the first click. Heads sitting on
 * the rim may not point straight off the board except as a last-resort
 * two-cell crumb.
 */
export class SLevelGenerator {
  private rays: RayCache | null = null;
  private zoneBanActive = false;
  private bannedZone: number | null = null;
  private bannedRemaining = 0;
  private zoneDirCounts: number[][] = [];
  private zoneDirTotals: number[] = [];
  private quotaActive = true;
  private spoonStrict = true;

  generate(options: SLevelGeneratorOptions): Level {
    const { sLevelIndex } = options;
    const seed = resolveGenerationSeed(options);

    const matrix = options.shapeMatrix
      ? options.shapeMatrix.map((row) => [...row])
      : this.createBorderedMatrix(this.resolveInteriorSize(sLevelIndex, options.gridSize));

    const floorCells = this.countFloorCells(matrix);
    const density = Math.max(options.targetDensity ?? DEFAULT_S_DENSITY, CORE_COVERAGE);
    const maxLen = options.maxArrowLength ?? DEFAULT_MAX_ARROW_LENGTH;
    const minLen = Math.min(DEFAULT_MIN_ARROW_LENGTH, maxLen);
    const maxTail = options.maxTailLength ?? DEFAULT_MAX_TAIL_LENGTH;
    const minArrows = options.minArrows ?? (options.shapeMatrix ? 0 : MIN_ARROWS);

    const built = this.buildAttempt({
      sLevelIndex,
      seed,
      matrix,
      floorCells,
      density,
      maxLen,
      minLen,
      maxTail,
      minArrows,
    });
    let best = built;
    let bestFill = floorCells === 0 ? 1 : this.totalCells(best.level.arrows) / floorCells;
    const retryBudget = bestFill < CORE_COVERAGE ? (floorCells <= 2200 ? 2 : 4) : 0;
    for (let retry = 1; retry <= retryBudget && bestFill < CORE_COVERAGE; retry++) {
      const alt = this.buildAttempt({
        sLevelIndex,
        seed: mixSeed(seed, retry * 0x9e3779b1),
        matrix: matrix.map((row) => [...row]),
        floorCells,
        density,
        maxLen,
        minLen,
        maxTail,
        minArrows,
      });
      const fill = floorCells === 0 ? 1 : this.totalCells(alt.level.arrows) / floorCells;
      if (fill > bestFill) {
        best = alt;
        bestFill = fill;
      }
    }
    best.level.metadata.seed = seed;
    return best.level;
  }

  private buildAttempt(args: {
    sLevelIndex: number;
    seed: number;
    matrix: CellValue[][];
    floorCells: number;
    density: number;
    maxLen: number;
    minLen: number;
    maxTail: number;
    minArrows: number;
  }): { level: Level; coreCoverage: number; solvable: boolean } {
    const { sLevelIndex, seed, matrix, floorCells, density, maxLen, minLen, maxTail, minArrows } =
      args;
    const rng = new SeededRandom(seed);
    const rows = matrix.length;
    const cols = matrix[0].length;
    const occupancy = this.createOccupancy(rows, cols);
    const targetOccupiedCells = Math.floor(floorCells * density);
    this.rays = this.emptyRayCache();
    this.zoneBanActive = true;
    this.bannedZone = null;
    this.bannedRemaining = 0;
    this.resetDirectionQuota();
    this.quotaActive = true;
    this.spoonStrict = true;

    const arrows: ArrowDefinition[] = [];
    let nextIndex = 0;

    const maxAttempts = Math.max(240, Math.min(900, floorCells * 4));
    let attempts = 0;
    let consecutiveFailures = 0;

    while (
      (this.totalCells(arrows) < targetOccupiedCells || arrows.length < minArrows) &&
      attempts < maxAttempts
    ) {
      attempts++;
      const isFirst = arrows.length === 0;
      const requireBlock = !isFirst && consecutiveFailures < 12;
      const frontierOnly = consecutiveFailures < 16;
      this.zoneBanActive = consecutiveFailures < 4;
      this.quotaActive = consecutiveFailures < 10;
      const reach = this.snakeReachCap(occupancy, maxLen);
      const snakeMax = this.rollSnakeMax(rng, reach, isFirst, true);
      const snakeMin = isFirst
        ? Math.min(FIRST_ARROW_MIN, snakeMax)
        : Math.min(minLen, Math.max(FILLER_LONG_MIN, Math.ceil(Math.min(snakeMax, 18) * 0.45)));

      const candidate = this.tryPlaceSnake(
        occupancy,
        matrix,
        arrows,
        nextIndex,
        snakeMax,
        snakeMin,
        rng,
        { requireBlock, frontierOnly, allowCheap: consecutiveFailures >= 20, allowLive: false },
      );

      if (!candidate) {
        if (++consecutiveFailures >= CORE_SATURATION_RETRIES) break;
        continue;
      }
      if (!this.tryCommit(arrows, occupancy, matrix, candidate)) {
        if (++consecutiveFailures >= CORE_SATURATION_RETRIES) break;
        continue;
      }
      this.noteHeadZone(candidate, occupancy);
      nextIndex++;
      consecutiveFailures = 0;
    }

    this.growTails(arrows, occupancy, matrix, Math.max(maxTail, this.snakeReachCap(occupancy, maxLen)), rng);
    this.rebuildAllRays(arrows, occupancy, matrix);
    const coreCoverage = floorCells === 0 ? 1 : this.totalCells(arrows) / floorCells;

    this.packHoles(arrows, occupancy, matrix, rng, maxLen, maxTail);
    this.fillEmptyRegions(arrows, occupancy, matrix, rng, maxTail, 0, maxLen);
    this.fillGaps(arrows, occupancy, matrix, rng, maxTail);
    this.packHoles(arrows, occupancy, matrix, rng, maxLen, maxTail, arrows.length + 80_000);
    this.fillGaps(arrows, occupancy, matrix, rng, maxTail, arrows.length + 90_000);
    this.densify(arrows, occupancy, matrix, rng, maxLen, maxTail, arrows.length + 100_000);

    this.popUntilSolvable(arrows, occupancy, matrix);
    const occupiedCells = this.totalCells(arrows);
    const grid: LevelGrid = { rows, cols, matrix };
    const solved = this.removalOrder(arrows, occupancy, matrix);
    const solutionOrder = (solved ?? [...arrows].reverse()).map((a) => a.id);
    this.rays = null;

    return {
      coreCoverage,
      solvable: solved !== null,
      level: {
        id: formatSLevelId(sLevelIndex),
        source: 'procedural',
        version: 1,
        grid,
        arrows,
        metadata: {
          arrowCount: arrows.length,
          seed,
          difficulty: this.inferDifficulty(occupiedCells, floorCells),
          solutionOrder,
        },
      },
    };
  }

  /**
   * Fill leftover floor using the same hole / pocket / crumb passes as generate.
   * Existing arrows are kept; new pieces get ids that will not collide with them.
   */
  fillVacancies(level: Level, seed?: number): Level {
    const arrows = level.arrows.map((arrow) => ({
      ...arrow,
      cells: arrow.cells.map((cell) => ({ ...cell })),
    }));
    const matrix = level.grid.matrix.map((row) => [...row]);
    const occupancy = this.createOccupancy(level.grid.rows, level.grid.cols);
    for (const arrow of arrows) this.commitArrow(occupancy, arrow);
    this.rays = this.emptyRayCache();
    this.rebuildAllRays(arrows, occupancy, matrix);
    this.zoneBanActive = false;
    this.bannedZone = null;
    this.bannedRemaining = 0;
    this.resetDirectionQuota();
    for (const arrow of arrows) this.recordDirectionQuota(arrow, occupancy);
    this.quotaActive = true;

    const rng = new SeededRandom(seed ?? (level.metadata.seed ?? 1) * 1_000_003 + arrows.length + 17);
    const serial = arrows.length + 10_000;
    this.packHoles(arrows, occupancy, matrix, rng, DEFAULT_MAX_ARROW_LENGTH, DEFAULT_MAX_TAIL_LENGTH, serial);
    this.fillEmptyRegions(arrows, occupancy, matrix, rng, DEFAULT_MAX_TAIL_LENGTH, serial, DEFAULT_MAX_ARROW_LENGTH);
    this.fillGaps(arrows, occupancy, matrix, rng, DEFAULT_MAX_TAIL_LENGTH, serial);
    this.densify(
      arrows,
      occupancy,
      matrix,
      rng,
      DEFAULT_MAX_ARROW_LENGTH,
      DEFAULT_MAX_TAIL_LENGTH,
      serial + 20_000,
    );
    this.popUntilSolvable(arrows, occupancy, matrix);
    this.rays = null;

    const occupiedCells = this.totalCells(arrows);
    const floorCells = this.countFloorCells(matrix);
    const solved = this.removalOrder(arrows, occupancy, matrix, rng);

    return {
      ...level,
      grid: { ...level.grid, matrix },
      arrows,
      metadata: {
        ...level.metadata,
        arrowCount: arrows.length,
        difficulty: this.inferDifficulty(occupiedCells, floorCells),
        solutionOrder: solved ? solved.map((arrow) => arrow.id) : undefined,
      },
    };
  }

  /**
   * Leftover holes: try long interlocking snakes that block existing rays.
   * After 95% fill or several misses, drop to short 4-cell plugs with no blocking.
   * `force` keeps packing locally (no hunt, no block requirement, 2-cell floor)
   * so a late densify pass can still push coverage to 95%.
   */
  private packHoles(
    arrows: ArrowDefinition[],
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    rng: SeededRandom,
    maxLen: number,
    maxTail: number,
    startIndex?: number,
    force = false,
    micro = false,
  ): void {
    const floor = this.countFloorCells(matrix);
    if (floor === 0) return;
    this.zoneBanActive = false;
    this.bannedZone = null;
    this.bannedRemaining = 0;
    const restoreSpoon = this.spoonStrict;
    this.spoonStrict = false;
    const restoreQuota = this.quotaActive;
    if (force) this.quotaActive = false;

    let nextIndex = startIndex ?? arrows.length;
    let longFails = 0;
    let relaxed = micro || (force && this.totalCells(arrows) / floor >= 0.93);

    while (this.totalCells(arrows) / floor < PACK_TARGET) {
      const density = this.totalCells(arrows) / floor;
      const empty = floor - this.totalCells(arrows);
      const failBudget =
        force || density < CORE_COVERAGE
          ? Math.min(160, Math.max(FILLER_QUICK_ATTEMPTS * 3, Math.floor(empty / 4)))
          : FILLER_QUICK_ATTEMPTS;
      if (!relaxed && (density > 0.97 || longFails >= failBudget)) {
        relaxed = true;
        longFails = 0;
      }
      this.quotaActive = force ? false : !relaxed;

      const snakeMax = relaxed
        ? micro
          ? GAP_FILL_MAX_LENGTH
          : Math.max(FILLER_RELAX_MIN, 4)
        : rng.nextInt(FILLER_LONG_MIN, FILLER_LONG_MAX);
      const minLen = relaxed
        ? micro
          ? GAP_FILL_MAX_LENGTH
          : FILLER_RELAX_MIN
        : Math.min(FILLER_LONG_MIN, snakeMax);
      const candidate = this.tryPlaceSnake(
        occupancy,
        matrix,
        arrows,
        nextIndex,
        Math.min(snakeMax, this.snakeReachCap(occupancy, Math.max(maxLen, 12))),
        minLen,
        rng,
        {
          requireBlock: !relaxed,
          frontierOnly: !relaxed && !force && density >= 0.9,
          allowCheap: force || relaxed || density < 0.94,
          allowLive: force || density < 0.95,
          hunt: density < CORE_COVERAGE,
          preferPerp: !force,
        },
      );
      if (!candidate) {
        longFails++;
        if (relaxed && longFails >= failBudget) break;
        continue;
      }
      const placed = { ...candidate, role: 'filler' as const };
      if (!this.tryCommit(arrows, occupancy, matrix, placed)) {
        longFails++;
        if (relaxed && longFails >= failBudget) break;
        continue;
      }
      nextIndex++;
      longFails = 0;
    }

    this.growTails(arrows, occupancy, matrix, Math.max(maxTail, this.snakeReachCap(occupancy, maxLen)), rng);
    this.rebuildAllRays(arrows, occupancy, matrix);
    this.spoonStrict = restoreSpoon;
    this.quotaActive = restoreQuota;
  }

  /**
   * Extra packing rounds until the silhouette is at least 95% covered.
   * Quota and anti-spoon stay off so leftover 1-wide channels can still fill.
   */
  private densify(
    arrows: ArrowDefinition[],
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    rng: SeededRandom,
    maxLen: number,
    maxTail: number,
    serial: number,
  ): void {
    const floor = this.countFloorCells(matrix);
    if (floor === 0) return;
    const restoreQuota = this.quotaActive;
    const restoreSpoon = this.spoonStrict;
    this.quotaActive = false;
    this.spoonStrict = false;
    this.zoneBanActive = false;

    let previous = -1;
    for (let round = 0; round < 3; round++) {
      const filled = this.totalCells(arrows);
      if (filled / floor >= CORE_COVERAGE) break;
      if (filled === previous) break;
      previous = filled;
      this.packHoles(arrows, occupancy, matrix, rng, maxLen, maxTail, serial + round * 25_000, true);
      if (this.totalCells(arrows) / floor >= CORE_COVERAGE) break;
      this.fillEmptyRegions(
        arrows,
        occupancy,
        matrix,
        rng,
        maxTail,
        serial + 8_000 + round * 25_000,
        maxLen,
      );
      this.fillGaps(arrows, occupancy, matrix, rng, maxTail, serial + 16_000 + round * 25_000);
    }

    if (this.totalCells(arrows) / floor < CORE_COVERAGE) {
      this.packHoles(arrows, occupancy, matrix, rng, maxLen, maxTail, serial + 90_000, true, true);
      this.fillGaps(arrows, occupancy, matrix, rng, maxTail, serial + 95_000);
    }

    this.quotaActive = restoreQuota;
    this.spoonStrict = restoreSpoon;
  }

  /**
   * Final mop-up: 2-cell crumbs, and leftover 3–5 cell pockets as one snake.
   */
  private fillGaps(
    arrows: ArrowDefinition[],
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    rng: SeededRandom,
    maxTail: number,
    startCrumb = 0,
  ): void {
    const floor = this.countFloorCells(matrix);
    if (floor === 0) return;

    let crumbIndex = startCrumb;
    let fillerIndex = startCrumb + 50_000;
    const banned = new Set<string>();
    const density = floor === 0 ? 1 : this.totalCells(arrows) / floor;
    const liveRays = density >= 0.97 ? this.liveRayCells() : new Set<string>();
    const regions = this.emptyRegions(occupancy, matrix);

    for (const region of regions) {
      const parts = this.offRayGroups(region, liveRays);
      for (const part of parts) {
        if (part.length < 2) continue;
        const pocket = new Set(part.map((cell) => this.key(cell)));
        if (part.length <= CRUMB_POCKET_MAX) {
          const candidate = this.tryPlaceCrumb(
            occupancy,
            matrix,
            rng,
            crumbIndex,
            banned,
            pocket,
            arrows,
          );
          if (!candidate) continue;
          if (!this.tryCommit(arrows, occupancy, matrix, candidate)) continue;
          crumbIndex++;
          continue;
        }
        const candidate = this.tryPlacePocketSnake(
          occupancy,
          matrix,
          pocket,
          null,
          fillerIndex,
          part.length,
          Math.min(FILLER_RELAX_MIN, part.length),
          false,
          banned,
          rng,
          arrows,
        );
        if (!candidate) continue;
        if (!this.tryCommit(arrows, occupancy, matrix, candidate)) continue;
        fillerIndex++;
      }
    }

    this.growTails(arrows, occupancy, matrix, Math.max(maxTail, this.snakeReachCap(occupancy, 12)), rng);
    this.rebuildAllRays(arrows, occupancy, matrix);
  }

  /**
   * Each leftover empty region is generated as its own reverse-solvable
   * puzzle: long 2-wide sweeps, packed from the wall inward, each new piece
   * blocking the previous one's inner ray.
   */
  private fillEmptyRegions(
    arrows: ArrowDefinition[],
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    rng: SeededRandom,
    maxTail: number,
    startFiller = 0,
    maxLen = POCKET_SNAKE_MAX,
  ): void {
    let fillerIndex = startFiller;
    const floor = this.countFloorCells(matrix);
    const density = floor === 0 ? 1 : this.totalCells(arrows) / floor;
    const liveRays = density >= 0.97 ? this.liveRayCells() : new Set<string>();
    const regions = this.emptyRegions(occupancy, matrix);
    for (const region of regions) {
      const parts = this.offRayGroups(region, liveRays);
      for (const part of parts) {
        if (part.length <= CRUMB_POCKET_MAX) continue;
        const added = this.fillRegionAsPuzzle(
          arrows,
          occupancy,
          matrix,
          rng,
          part,
          fillerIndex,
          maxLen,
        );
        fillerIndex += added;
      }
    }
    this.growTails(arrows, occupancy, matrix, Math.max(maxTail, this.snakeReachCap(occupancy, maxLen)), rng);
    this.rebuildAllRays(arrows, occupancy, matrix);
  }

  private fillRegionAsPuzzle(
    arrows: ArrowDefinition[],
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    rng: SeededRandom,
    region: GridCell[],
    fillerIndex: number,
    maxLen: number,
  ): number {
    const pocket = new Set(region.map((cell) => this.key(cell)));
    const snakeCap = Math.min(
      Math.max(maxLen, POCKET_SNAKE_MAX),
      Math.max(FILLER_LONG_MIN, region.length),
    );
    const longMin = region.length >= FILLER_LONG_MIN ? FILLER_LONG_MIN : region.length;
    let last: ArrowDefinition | null = null;
    let placed = 0;
    let fails = 0;
    let relaxed = false;
    const banned = new Set<string>();
    const failLimit = Math.max(
      FILLER_QUICK_ATTEMPTS,
      Math.min(80, Math.floor(region.length / 2)),
    );

    while (this.emptyInPocket(occupancy, pocket) >= 2) {
      const remaining = this.emptyInPocket(occupancy, pocket);
      if (remaining <= CRUMB_POCKET_MAX && relaxed) break;

      if (!relaxed && fails >= failLimit) {
        relaxed = true;
        fails = 0;
      }

      const requireBlock = !relaxed && last !== null;
      const floorLen = relaxed
        ? FILLER_RELAX_MIN
        : remaining >= FILLER_LONG_MIN
          ? longMin
          : remaining;
      const candidate = this.tryPlacePocketSnake(
        occupancy,
        matrix,
        pocket,
        last,
        fillerIndex + placed,
        relaxed ? Math.max(floorLen, 4) : snakeCap,
        floorLen,
        requireBlock,
        banned,
        rng,
        arrows,
      );
      if (!candidate) {
        fails++;
        if (relaxed && fails >= failLimit) break;
        continue;
      }

      const head = candidate.cells[candidate.cells.length - 1];
      if (!this.tryCommit(arrows, occupancy, matrix, candidate)) {
        banned.add(`${head.row},${head.col}:${candidate.direction}`);
        fails++;
        if (relaxed && fails >= failLimit) break;
        continue;
      }

      last = candidate;
      placed++;
      fails = 0;
    }

    return placed;
  }

  private tryPlacePocketSnake(
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    pocket: Set<string>,
    last: ArrowDefinition | null,
    fillerIndex: number,
    maxLen: number,
    minLen: number,
    requireBlock: boolean,
    banned: Set<string>,
    rng: SeededRandom,
    placedArrows: ArrowDefinition[],
  ): ArrowDefinition | null {
    const empty = this.pocketCells(occupancy, pocket);
    if (empty.length < 2) return null;

    const focusRay = last
      ? this.collectPocketRay(last, occupancy, matrix, pocket)
      : this.pickFocusRay(placedArrows, occupancy, matrix, rng);
    const ordered = rng.shuffle(this.orderPocketHeads(empty, occupancy, focusRay, last === null));
    const heads = (
      requireBlock && focusRay.size > 0
        ? ordered.filter((cell) => focusRay.has(this.key(cell)))
        : ordered
    ).slice(0, Math.max(120, empty.length));

    for (const head of heads) {
      if (occupancy.cells[head.row][head.col] !== null) continue;
      const dirs = this.rankPocketDirections(
        head,
        occupancy,
        matrix,
        pocket,
        last === null,
        last?.direction ?? null,
      );
      for (const direction of dirs) {
        if (banned.has(`${head.row},${head.col}:${direction}`)) continue;
        if (!this.escapesOnceOccupantsLeave(occupancy, matrix, head, direction)) {
          continue;
        }
        const delta = DIRECTION_DELTA[direction];
        const liveNow = this.laneLength(occupancy, matrix, head.row, head.col, delta) >= 0;
        // Pocket pieces wait for the lid; they must not be free clicks at the start.
        if (liveNow) continue;

        const snakeMax = this.rollSnakeMax(rng, maxLen, last === null, true);
        const need = Math.min(minLen, snakeMax);
        const grown = this.growSnake(
          head,
          direction,
          occupancy,
          matrix,
          rng,
          snakeMax,
          need,
          focusRay,
          pocket,
          placedArrows,
          false,
        );
        if (!grown) continue;

        const blocks = focusRay.has(this.key(head)) || this.bodyHits(grown, focusRay, head);
        if (requireBlock && focusRay.size > 0 && !blocks) continue;

        return {
          id: `filler-${fillerIndex}-${head.row}x${head.col}`,
          cells: grown,
          direction,
          role: 'filler',
        };
      }
    }

    return null;
  }

  private orderPocketHeads(
    empty: GridCell[],
    occupancy: OccupancyGrid,
    focusRay: Set<string>,
    first: boolean,
  ): GridCell[] {
    const score = (cell: GridCell): number => {
      let value = 0;
      if (first) {
        // Sit on the lid so this piece waits; rim-facing heads are free clicks.
        if (this.touchesOccupied(occupancy, cell)) value += 120;
      } else {
        if (focusRay.has(this.key(cell))) value += 1000;
        if (this.touchesOccupied(occupancy, cell)) value += 100;
      }
      return value;
    };

    return [...empty].sort((a, b) => score(b) - score(a));
  }

  private rankPocketDirections(
    head: GridCell,
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    pocket: Set<string>,
    first: boolean,
    lastDir: Direction | null,
  ): Direction[] {
    const scored = ALL_DIRECTIONS.map((direction) => {
      const inner = this.pocketLane(head, direction, occupancy, pocket);
      const toLid = this.stepsToOccupant(head, direction, occupancy, matrix);
      let score = 0;
      if (first) {
        score = (toLid === 1 ? 80 : 0) + inner - (toLid > 8 ? 30 : 0);
      } else {
        score = (toLid === 1 ? 40 : 0) + inner;
      }
      if (lastDir) {
        if (this.axisOf(direction) === this.axisOf(lastDir)) score -= 25;
        else score += 20;
      }
      return { direction, score };
    });
    scored.sort((a, b) => b.score - a.score || a.direction.localeCompare(b.direction));
    return scored.map((item) => item.direction);
  }

  private pocketLane(
    head: GridCell,
    direction: Direction,
    occupancy: OccupancyGrid,
    pocket: Set<string>,
  ): number {
    const delta = DIRECTION_DELTA[direction];
    let row = head.row + delta.row;
    let col = head.col + delta.col;
    let steps = 0;
    while (pocket.has(this.key({ row, col })) && occupancy.cells[row]?.[col] === null) {
      steps++;
      row += delta.row;
      col += delta.col;
    }
    return steps;
  }

  private stepsToOccupant(
    head: GridCell,
    direction: Direction,
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
  ): number {
    const delta = DIRECTION_DELTA[direction];
    let row = head.row + delta.row;
    let col = head.col + delta.col;
    let steps = 1;
    while (this.isInside(occupancy, row, col)) {
      if (matrix[row][col] === CELL_BLOCKER) return 99;
      if (occupancy.cells[row][col] !== null) return steps;
      steps++;
      row += delta.row;
      col += delta.col;
    }
    return 99;
  }

  private collectPocketRay(
    arrow: ArrowDefinition,
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    pocket: Set<string>,
  ): Set<string> {
    const rays = new Set<string>();
    const delta = DIRECTION_DELTA[arrow.direction];
    const head = arrow.cells[arrow.cells.length - 1];
    let row = head.row + delta.row;
    let col = head.col + delta.col;
    while (this.isInside(occupancy, row, col)) {
      if (matrix[row][col] === CELL_BLOCKER) break;
      if (occupancy.cells[row][col] !== null) break;
      if (pocket.has(this.key({ row, col }))) rays.add(this.key({ row, col }));
      row += delta.row;
      col += delta.col;
    }
    return rays;
  }

  private pocketCells(occupancy: OccupancyGrid, pocket: Set<string>): GridCell[] {
    const cells: GridCell[] = [];
    for (const key of pocket) {
      const [row, col] = key.split(',').map(Number);
      if (occupancy.cells[row][col] !== null) continue;
      cells.push({ row, col });
    }
    return cells;
  }

  private emptyInPocket(occupancy: OccupancyGrid, pocket: Set<string>): number {
    let count = 0;
    for (const key of pocket) {
      const [row, col] = key.split(',').map(Number);
      if (occupancy.cells[row][col] === null) count++;
    }
    return count;
  }

  /** True when ignoring other arrows, this head still reaches off the board. */
  private escapesOnceOccupantsLeave(
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    head: GridCell,
    direction: Direction,
  ): boolean {
    const delta = DIRECTION_DELTA[direction];
    let row = head.row + delta.row;
    let col = head.col + delta.col;
    while (this.isInside(occupancy, row, col)) {
      if (matrix[row][col] === CELL_BLOCKER) return false;
      row += delta.row;
      col += delta.col;
    }
    return true;
  }

  private touchesOccupied(occupancy: OccupancyGrid, cell: GridCell): boolean {
    for (const step of [
      { row: 1, col: 0 },
      { row: -1, col: 0 },
      { row: 0, col: 1 },
      { row: 0, col: -1 },
    ]) {
      const row = cell.row + step.row;
      const col = cell.col + step.col;
      if (!this.isInside(occupancy, row, col)) continue;
      if (occupancy.cells[row][col] !== null) return true;
    }
    return false;
  }

  /**
   * Every connected patch of empty floor with at least two cells. Includes
   * regions that still have a live exit somewhere — the rest of the patch is
   * still a hole that needs fillers.
   */
  private emptyRegions(
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
  ): GridCell[][] {
    const seen: boolean[][] = Array.from({ length: occupancy.rows }, () =>
      Array<boolean>(occupancy.cols).fill(false),
    );
    const regions: GridCell[][] = [];

    for (let row = 0; row < occupancy.rows; row++) {
      for (let col = 0; col < occupancy.cols; col++) {
        if (seen[row][col]) continue;
        if (matrix[row][col] !== CELL_FLOOR) continue;
        if (occupancy.cells[row][col] !== null) continue;

        const cells: GridCell[] = [];
        const stack: GridCell[] = [{ row, col }];
        seen[row][col] = true;

        while (stack.length > 0) {
          const cell = stack.pop()!;
          cells.push(cell);
          for (const step of [
            { row: 1, col: 0 },
            { row: -1, col: 0 },
            { row: 0, col: 1 },
            { row: 0, col: -1 },
          ]) {
            const nr = cell.row + step.row;
            const nc = cell.col + step.col;
            if (!this.isInside(occupancy, nr, nc) || seen[nr][nc]) continue;
            if (matrix[nr][nc] !== CELL_FLOOR) continue;
            if (occupancy.cells[nr][nc] !== null) continue;
            seen[nr][nc] = true;
            stack.push({ row: nr, col: nc });
          }
        }

        if (cells.length >= 2) regions.push(cells);
      }
    }

    return regions;
  }

  private uncommitCells(occupancy: OccupancyGrid, cells: GridCell[]): void {
    for (const cell of cells) occupancy.cells[cell.row][cell.col] = null;
  }

  private emptyRayCache(): RayCache {
    return { byId: new Map(), unblocked: [], cellToIds: new Map() };
  }

  private rebuildAllRays(
    arrows: ArrowDefinition[],
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
  ): void {
    this.rays = this.emptyRayCache();
    for (const arrow of arrows) this.syncRay(arrow, occupancy, matrix);
  }

  private tryCommit(
    arrows: ArrowDefinition[],
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    arrow: ArrowDefinition,
  ): boolean {
    if (this.blocksAndWaitsForSame(arrow, occupancy, matrix)) return false;
    this.commitArrow(occupancy, arrow);
    arrows.push(arrow);
    this.noteOccupied(arrows, occupancy, matrix, arrow);
    if (!this.removalOrder(arrows, occupancy, matrix)) {
      arrows.pop();
      this.uncommitCells(occupancy, arrow.cells);
      this.rebuildAllRays(arrows, occupancy, matrix);
      return false;
    }
    this.recordDirectionQuota(arrow, occupancy);
    return true;
  }

  private popUntilSolvable(
    arrows: ArrowDefinition[],
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
  ): void {
    if (this.removalOrder(arrows, occupancy, matrix)) return;
    for (let i = arrows.length - 1; i >= 1; i--) {
      if (arrows[i].role !== 'filler' && arrows[i].role !== 'crumb') continue;
      const [removed] = arrows.splice(i, 1);
      this.uncommitCells(occupancy, removed.cells);
      this.recordDirectionQuota(removed, occupancy, -1);
      this.rebuildAllRays(arrows, occupancy, matrix);
      if (this.removalOrder(arrows, occupancy, matrix)) return;
    }
  }

  private blocksAndWaitsForSame(
    arrow: ArrowDefinition,
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
  ): boolean {
    const cache = this.rays;
    if (!cache) return false;
    const blocked = new Set<string>();
    for (const cell of arrow.cells) {
      const owners = cache.cellToIds.get(this.key(cell));
      if (!owners) continue;
      for (const id of owners) blocked.add(id);
    }
    if (blocked.size === 0) return false;
    const delta = DIRECTION_DELTA[arrow.direction];
    const head = arrow.cells[arrow.cells.length - 1];
    let row = head.row + delta.row;
    let col = head.col + delta.col;
    while (this.isInside(occupancy, row, col)) {
      if (matrix[row][col] === CELL_BLOCKER) return false;
      const occ = occupancy.cells[row][col];
      if (occ !== null && occ !== arrow.id) return blocked.has(occ);
      row += delta.row;
      col += delta.col;
    }
    return false;
  }

  private noteOccupied(
    arrows: ArrowDefinition[],
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    placed: ArrowDefinition,
  ): void {
    const cache = this.rays;
    if (!cache) {
      this.rebuildAllRays(arrows, occupancy, matrix);
      return;
    }
    const affected = new Set<string>();
    for (const cell of placed.cells) {
      const owners = cache.cellToIds.get(this.key(cell));
      if (!owners) continue;
      for (const id of owners) affected.add(id);
    }
    const byId = new Map(arrows.map((arrow) => [arrow.id, arrow]));
    for (const id of affected) {
      const arrow = byId.get(id);
      if (arrow && arrow.id !== placed.id) this.syncRay(arrow, occupancy, matrix);
    }
    this.syncRay(placed, occupancy, matrix);
  }

  private syncRay(
    arrow: ArrowDefinition,
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
  ): void {
    const cache = this.rays;
    if (!cache) return;
    this.clearRayIndex(arrow.id);
    const cellSet = new Set<string>();
    const delta = DIRECTION_DELTA[arrow.direction];
    const head = arrow.cells[arrow.cells.length - 1];
    let row = head.row + delta.row;
    let col = head.col + delta.col;
    let live = true;
    while (this.isInside(occupancy, row, col)) {
      if (matrix[row][col] === CELL_BLOCKER) {
        live = false;
        break;
      }
      const occ = occupancy.cells[row][col];
      if (occ !== null && occ !== arrow.id) {
        live = false;
        break;
      }
      if (matrix[row][col] === CELL_FLOOR && occ === null) {
        const key = this.key({ row, col });
        cellSet.add(key);
        let owners = cache.cellToIds.get(key);
        if (!owners) {
          owners = new Set();
          cache.cellToIds.set(key, owners);
        }
        owners.add(arrow.id);
      }
      row += delta.row;
      col += delta.col;
    }
    cache.byId.set(arrow.id, { cellSet, live, direction: arrow.direction });
    const queued = cache.unblocked.indexOf(arrow.id);
    if (cellSet.size > 0) {
      if (queued < 0) cache.unblocked.push(arrow.id);
    } else if (queued >= 0) {
      cache.unblocked.splice(queued, 1);
    }
  }

  private clearRayIndex(arrowId: string): void {
    const cache = this.rays;
    if (!cache) return;
    const prev = cache.byId.get(arrowId);
    if (prev) {
      for (const key of prev.cellSet) {
        const owners = cache.cellToIds.get(key);
        if (!owners) continue;
        owners.delete(arrowId);
        if (owners.size === 0) cache.cellToIds.delete(key);
      }
    }
    cache.byId.delete(arrowId);
  }

  private liveRayCells(): Set<string> {
    const cache = this.rays;
    if (!cache) return new Set();
    const cells = new Set<string>();
    for (const ray of cache.byId.values()) {
      if (!ray.live) continue;
      for (const key of ray.cellSet) cells.add(key);
    }
    return cells;
  }

  private allRayCells(): Set<string> {
    const cache = this.rays;
    if (!cache) return new Set();
    const cells = new Set<string>();
    for (const ray of cache.byId.values()) {
      for (const key of ray.cellSet) cells.add(key);
    }
    return cells;
  }

  /**
   * Two-cell arrow for a dead-end pocket smaller than 3 cells. May wait for
   * neighbours to leave; does not require a live ray at placement time.
   */
  private tryPlaceCrumb(
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    rng: SeededRandom,
    crumbIndex: number,
    banned: Set<string>,
    pocket?: Set<string>,
    placedArrows: ArrowDefinition[] = [],
  ): ArrowDefinition | null {
    const empty: GridCell[] = [];
    for (let row = 0; row < occupancy.rows; row++) {
      for (let col = 0; col < occupancy.cols; col++) {
        if (matrix[row][col] !== CELL_FLOOR) continue;
        if (occupancy.cells[row][col] !== null) continue;
        if (pocket && !pocket.has(this.key({ row, col }))) continue;
        empty.push({ row, col });
      }
    }
    if (empty.length < 2 || empty.length > CRUMB_POCKET_MAX) return null;

    const frontier = empty.filter((cell) => this.touchesOccupied(occupancy, cell));
    const rest = empty.filter((cell) => !this.touchesOccupied(occupancy, cell));
    const ordered = [...rng.shuffle(frontier), ...rng.shuffle(rest)];

    for (const head of ordered) {
      if (occupancy.cells[head.row][head.col] !== null) continue;
      const directions = this.orderCrumbDirections(occupancy, matrix, head, rng);
      
      for (const direction of directions) {
        if (banned.has(`${head.row},${head.col}:${direction}`)) continue;

        if (!this.escapesOnceOccupantsLeave(occupancy, matrix, head, direction)) {
          continue;
        }
        const liveNow =
          this.laneLength(
            occupancy,
            matrix,
            head.row,
            head.col,
            DIRECTION_DELTA[direction],
          ) >= 0;
        if (liveNow && this.countLiveArrows(placedArrows, occupancy, matrix) >= MAX_OPENING_MOVES) {
          continue;
        }
        const grown = this.growSnake(
          head,
          direction,
          occupancy,
          matrix,
          rng,
          GAP_FILL_MAX_LENGTH,
          2,
          new Set(),
          pocket ?? null,
          placedArrows,
          false,
        );
        if (!grown) continue;
        return {
          id: `crumb-${crumbIndex}-${head.row}x${head.col}`,
          cells: grown,
          direction,
          role: 'crumb',
        };
      }
    }

    return null;
  }

  private tryPlaceSnake(
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    placed: ArrowDefinition[],
    arrowIndex: number,
    maxLen: number,
    minLen: number,
    rng: SeededRandom,
    opts: { requireBlock: boolean; frontierOnly: boolean; allowCheap?: boolean; allowLive?: boolean; hunt?: boolean; preferPerp?: boolean },
  ): ArrowDefinition | null {
    const growMax = this.snakeReachCap(occupancy, maxLen);
    const liveCount = this.countLiveArrows(placed, occupancy, matrix);

    if (placed.length === 0) {
      return this.searchPlacement(
        occupancy,
        matrix,
        placed,
        arrowIndex,
        growMax,
        minLen,
        rng,
        { ...opts, requireBlock: false, frontierOnly: false, allowLive: true, allowCheap: false },
        new Set(),
        false,
      );
    }

    if (placed.length > 0 && liveCount < MAX_OPENING_MOVES && rng.next() < 0.7) {
      const branch = this.searchPlacement(
        occupancy,
        matrix,
        placed,
        arrowIndex,
        growMax,
        minLen,
        rng,
        { ...opts, requireBlock: false, frontierOnly: false, allowLive: true, allowCheap: false },
        new Set(),
        false,
      );
      if (branch) return branch;
    }

    const rayTries = opts.requireBlock ? 2 : 1;
    for (let tryRay = 0; tryRay < rayTries; tryRay++) {
      const found = this.searchPlacement(
        occupancy,
        matrix,
        placed,
        arrowIndex,
        growMax,
        minLen,
        rng,
        opts,
        new Set(),
        opts.requireBlock,
        tryRay === 0 ? 'oldest' : 'random',
      );
      if (found) return found;
    }

    if (opts.requireBlock) return null;

    return this.searchPlacement(
      occupancy,
      matrix,
      placed,
      arrowIndex,
      growMax,
      minLen,
      rng,
      opts,
      this.allRayCells(),
      false,
    );
  }

  /**
   * Oldest unblocked ray in the FIFO, or a random one from the same pool.
   * When `perpTo` is set, the pool is first restricted to arrows whose escape
   * axis is perpendicular so the new piece crosses traffic instead of
   * stacking a same-direction jam. Falls back to the full queue if no
   * perpendicular ray is still open.
   */
  private pickFocusRay(
    placed: ArrowDefinition[],
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    rng: SeededRandom,
    mode: 'oldest' | 'random' = 'oldest',
    perpTo?: Direction,
  ): Set<string> {
    const cache = this.rays;
    if (cache && cache.unblocked.length > 0) {
      const perpIds = perpTo
        ? cache.unblocked.filter((id) => {
            const ray = cache.byId.get(id);
            return ray ? this.axisOf(ray.direction) !== this.axisOf(perpTo) : false;
          })
        : cache.unblocked;
      const poolIds = perpIds.length > 0 ? perpIds : cache.unblocked;
      const pickId =
        mode === 'random' && poolIds.length > 1 ? rng.pick(poolIds) : poolIds[0];
      const ray = cache.byId.get(pickId);
      return ray ? new Set(ray.cellSet) : new Set();
    }
    if (placed.length === 0) return new Set();
    const perpPool: Set<string>[] = [];
    const anyPool: Set<string>[] = [];
    for (const arrow of rng.shuffle(placed)) {
      const ray = this.collectRay(arrow, occupancy, matrix);
      if (ray.size === 0) continue;
      anyPool.push(ray);
      if (!perpTo || this.axisOf(arrow.direction) !== this.axisOf(perpTo)) perpPool.push(ray);
    }
    const pool = perpPool.length > 0 ? perpPool : anyPool;
    if (pool.length === 0) return new Set();
    return mode === 'oldest' ? pool[0] : rng.pick(pool);
  }

  private countLiveArrows(
    placed: ArrowDefinition[],
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
  ): number {
    const cache = this.rays;
    if (cache && cache.byId.size === placed.length) {
      let count = 0;
      for (const ray of cache.byId.values()) {
        if (ray.live) count += 1;
      }
      return count;
    }
    let count = 0;
    for (const arrow of placed) {
      const head = arrow.cells[arrow.cells.length - 1];
      if (
        this.hasClearRayToEdge(
          occupancy,
          matrix,
          head.row,
          head.col,
          DIRECTION_DELTA[arrow.direction],
          arrow.id,
        )
      ) {
        count += 1;
      }
    }
    return count;
  }

  private searchPlacement(
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    placed: ArrowDefinition[],
    arrowIndex: number,
    maxLen: number,
    minLen: number,
    rng: SeededRandom,
    opts: { requireBlock: boolean; frontierOnly: boolean; allowCheap?: boolean; allowLive?: boolean; hunt?: boolean; preferPerp?: boolean },
    rayCells: Set<string>,
    mustBlock: boolean,
    rayMode?: 'oldest' | 'random',
  ): ArrowDefinition | null {
    const liveRays = this.liveRayCells();
    const liveCount = this.countLiveArrows(placed, occupancy, matrix);
    const byId = new Map(placed.map((arrow) => [arrow.id, arrow]));
    const batches: {
      direction: Direction;
      legal: HeadCandidate[];
      banned: HeadCandidate[];
      focus: Set<string>;
      block: boolean;
    }[] = [];

    for (const direction of rng.shuffle(ALL_DIRECTIONS)) {
      const focus =
        rayMode !== undefined
          ? this.pickFocusRay(
              placed,
              occupancy,
              matrix,
              rng,
              rayMode,
              opts.preferPerp === false ? undefined : direction,
            )
          : rayCells;
      const blockThis = mustBlock && focus.size > 0;
      const huntFar = opts.hunt !== false && focus.size > 0 && (blockThis || rayMode !== undefined);
      const onRay =
        focus.size > 0
          ? this.findHeadCandidates(
              occupancy,
              matrix,
              direction,
              focus,
              false,
              true,
            )
          : [];
      const hunters = huntFar
        ? this.sampleHuntHeads(occupancy, matrix, direction, focus, rng, maxLen)
        : blockThis && focus.size > 0
          ? []
          : this.findHeadCandidates(
              occupancy,
              matrix,
              direction,
              focus,
              opts.frontierOnly && placed.length > 0 && !blockThis,
              false,
            );
      const heads = huntFar
        ? [
            ...this.orderHeads(hunters, rng, placed, occupancy, focus, maxLen).slice(0, 12),
            ...this.orderHeads(onRay, rng, placed, occupancy, focus, maxLen).slice(0, 16),
          ]
        : this.orderHeads(
            rng.shuffle([...hunters, ...onRay]),
            rng,
            placed,
            occupancy,
            focus,
            maxLen,
          ).slice(0, 32);
      if (heads.length === 0) continue;
      const legal = this.filterHeadsByZone(heads, occupancy);
      const quotaLegal = this.filterHeadsByQuota(legal, occupancy, direction);
      const banned = heads.filter((head) => this.zoneIsBanned(head.cell, occupancy));
      const quotaBanned = this.filterHeadsByQuota(banned, occupancy, direction);
      batches.push({
        direction,
        legal: quotaLegal.length > 0 ? quotaLegal : legal,
        banned: quotaBanned.length > 0 ? quotaBanned : banned,
        focus,
        block: blockThis,
      });
    }

    const tryHeads = (
      direction: Direction,
      candidates: HeadCandidate[],
      focus: Set<string>,
      blockThis: boolean,
    ): ArrowDefinition | null => {
      for (const candidate of candidates) {
        const delta = DIRECTION_DELTA[direction];
        if (
          this.countEmptyFloorAhead(
            occupancy,
            matrix,
            candidate.cell.row,
            candidate.cell.col,
            delta,
          ) === 0
        ) {
          continue;
        }

        if (blockThis && this.isCheapExit(candidate.lane)) continue;
        if (!opts.allowCheap && this.isCheapExit(candidate.lane)) continue;
        const liveNow =
          this.laneLength(
            occupancy,
            matrix,
            candidate.cell.row,
            candidate.cell.col,
            delta,
          ) >= 0;
        if (!blockThis && !opts.allowLive && liveNow) continue;
        if (this.spoonStrict && this.isSameDirectionSpoon(occupancy, byId, candidate.cell, direction)) {
          continue;
        }

        const cells = this.growSnake(
          candidate.cell,
          direction,
          occupancy,
          matrix,
          rng,
          maxLen,
          minLen,
          focus,
          null,
          placed,
          opts.hunt !== false,
        );
        if (!cells) continue;

        const blocks =
          candidate.blocks || this.bodyHits(cells, focus, candidate.cell);
        if (blockThis && placed.length > 0 && focus.size > 0 && !blocks) continue;
        if (liveNow && liveCount >= MAX_OPENING_MOVES) {
          const hitsLive = cells.some((cell) => liveRays.has(this.key(cell)));
          if (!hitsLive) continue;
        }

        return {
          id: `s${arrowIndex}-${candidate.cell.row}x${candidate.cell.col}`,
          cells,
          direction,
        };
      }
      return null;
    };

    for (const batch of batches) {
      const found = tryHeads(batch.direction, batch.legal, batch.focus, batch.block);
      if (found) return found;
    }

    for (const batch of batches) {
      const found = tryHeads(batch.direction, batch.banned, batch.focus, batch.block);
      if (found) return found;
    }

    return null;
  }

  private collectRay(
    arrow: ArrowDefinition,
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
  ): Set<string> {
    const rays = new Set<string>();
    const delta = DIRECTION_DELTA[arrow.direction];
    const head = arrow.cells[arrow.cells.length - 1];
    let row = head.row + delta.row;
    let col = head.col + delta.col;
    while (this.isInside(occupancy, row, col)) {
      if (matrix[row][col] === CELL_BLOCKER) break;
      if (occupancy.cells[row][col] !== null) break;
      if (matrix[row][col] === CELL_FLOOR) rays.add(this.key({ row, col }));
      row += delta.row;
      col += delta.col;
    }
    return rays;
  }

  /**
   * Greedy walk backwards from the head. After each turn a cooldown of 1–5
   * cells forces a straight run, so the body mixes tight stairs with longer
   * parallel lines instead of turning every cell.
   */
  private growSnake(
    head: GridCell,
    direction: Direction,
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    rng: SeededRandom,
    maxLen: number,
    minLen: number,
    rayCells: Set<string>,
    allowed: Set<string> | null = null,
    placed: ArrowDefinition[] = [],
    enableHunt = true,
  ): GridCell[] | null {
    const forward = DIRECTION_DELTA[direction];
    const back: GridCell = { row: -forward.row, col: -forward.col };
    const start: GridCell[] = [head];
    const neck: GridCell = { row: head.row + back.row, col: head.col + back.col };
    if (!this.canOccupy(occupancy, matrix, neck, start, head, direction, allowed)) {
      return null;
    }
    start.push(neck);

    const byId = new Map(placed.map((arrow) => [arrow.id, arrow]));
    if (
      this.spoonStrict &&
      (this.isSameDirectionSpoon(occupancy, byId, head, direction, start) ||
        this.isSameDirectionSpoon(occupancy, byId, neck, direction, start))
    ) {
      return null;
    }

    const hunt = enableHunt
      ? this.buildRayHunt(placed, rayCells, occupancy)
      : this.idleHunt(occupancy);
    const grown = this.growMeander(
      start,
      back,
      occupancy,
      matrix,
      head,
      direction,
      maxLen,
      hunt,
      rng,
      allowed,
      placed,
    );

    if (grown.length < minLen) return null;

    grown.reverse();
    return grown;
  }

  /**
   * Primary hunt ray plus other live openings the tail may clip afterwards.
   * Already-blocked leftover cells stay out of the bonus pool so a second
   * crossing actually locks another free path (a master key), and live
   * opening lanes stay in the pool except for the chosen focus.
   */
  private buildRayHunt(
    placed: ArrowDefinition[],
    focus: Set<string>,
    occupancy: OccupancyGrid,
  ): RayHunt {
    const bonus = new Set<string>();
    if (placed.length > 0) {
      for (const key of this.liveRayCells()) {
        if (!focus.has(key)) bonus.add(key);
      }
    }
    const rows = occupancy.rows;
    const cols = occupancy.cols;
    return {
      primary: focus,
      primaryCells: this.cellsFromKeys(focus),
      bonus,
      focusAxis: this.rayAxis(focus),
      centerRow0: rows * 0.25,
      centerRow1: rows * 0.75,
      centerCol0: cols * 0.25,
      centerCol1: cols * 0.75,
    };
  }

  private idleHunt(occupancy: OccupancyGrid): RayHunt {
    const rows = occupancy.rows;
    const cols = occupancy.cols;
    return {
      primary: new Set(),
      primaryCells: [],
      bonus: new Set(),
      focusAxis: null,
      centerRow0: rows * 0.25,
      centerRow1: rows * 0.75,
      centerCol0: cols * 0.25,
      centerCol1: cols * 0.75,
    };
  }

  private cellsFromKeys(keys: Set<string>): GridCell[] {
    const cells: GridCell[] = [];
    for (const key of keys) {
      const [row, col] = key.split(',').map(Number);
      cells.push({ row, col });
    }
    return cells;
  }

  private growMeander(
    start: GridCell[],
    back: GridCell,
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    head: GridCell,
    direction: Direction,
    maxLen: number,
    hunt: RayHunt,
    rng: SeededRandom,
    allowed: Set<string> | null,
    placed: ArrowDefinition[],
  ): GridCell[] {
    const grown: GridCell[] = [...start];
    let heading = back;
    let inbound: GridCell | null = null;
    let turnCooldown = rng.nextInt(TURN_COOLDOWN_MIN, TURN_COOLDOWN_MAX);
    const byId = new Map(placed.map((arrow) => [arrow.id, arrow]));
    const remainingBonus = new Set(hunt.bonus);
    let hitPrimary =
      hunt.primary.size === 0 || start.some((cell) => hunt.primary.has(this.key(cell)));
    for (const cell of start) this.consumeRayAt(this.key(cell), remainingBonus);
    let magnetCells = hitPrimary
      ? this.nearestBonusRayCells(start[start.length - 1], remainingBonus)
      : hunt.primaryCells;

    while (grown.length < maxLen) {
      const prev = grown[grown.length - 1];
      let options = this.scoredSteps(
        prev,
        heading,
        occupancy,
        matrix,
        grown,
        rng,
        hunt,
        hitPrimary,
        magnetCells,
        remainingBonus,
        head,
        direction,
        inbound,
        allowed,
        byId,
      );
      if (!hitPrimary) {
        const straight = options.filter((option) => !option.turned);
        const turns = options.filter((option) => option.turned);
        if (turnCooldown > 0 && straight.length > 0) {
          const turnBest = turns[0];
          if (!turnBest || turnBest.score < straight[0].score + HUNT_TURN_MARGIN) {
            options = straight;
          }
        }
        turnCooldown -= 1;
      } else if (turnCooldown > 0) {
        const straight = options.filter((option) => !option.turned);
        const turnBest = options.find((option) => option.turned);
        if (
          straight.length > 0 &&
          (!turnBest || turnBest.score < straight[0].score + HUNT_TURN_MARGIN)
        ) {
          options = straight;
        } else if (turnBest) {
          options = options.filter((option) => option.turned);
        }
        turnCooldown -= 1;
      } else {
        const turns = options.filter((option) => option.turned);
        if (turns.length > 0) options = turns;
      }
      if (options.length === 0) break;

      const pick = options[0];
      const step = { row: pick.cell.row - prev.row, col: pick.cell.col - prev.col };
      if (pick.turned) {
        inbound = heading;
        heading = step;
        turnCooldown = rng.nextInt(TURN_COOLDOWN_MIN, TURN_COOLDOWN_MAX);
      } else {
        heading = step;
      }
      grown.push(pick.cell);
      const landed = this.key(pick.cell);
      const blockedNew = remainingBonus.has(landed);
      if (hunt.primary.has(landed) && !hitPrimary) {
        hitPrimary = true;
        turnCooldown = 0;
      }
      if (blockedNew) {
        this.consumeRayAt(landed, remainingBonus);
        if (hitPrimary) turnCooldown = 0;
      }
      if (hitPrimary && (blockedNew || magnetCells.length === 0)) {
        magnetCells = this.nearestBonusRayCells(pick.cell, remainingBonus);
      }
    }

    return grown;
  }

  private scoredSteps(
    prev: GridCell,
    heading: GridCell,
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    path: GridCell[],
    rng: SeededRandom,
    hunt: RayHunt,
    hitPrimary: boolean,
    magnetCells: GridCell[],
    remainingBonus: Set<string>,
    head: GridCell,
    direction: Direction,
    inbound: GridCell | null,
    allowed: Set<string> | null = null,
    byId: Map<string, ArrowDefinition> = new Map(),
  ): Array<{ cell: GridCell; turned: boolean; score: number }> {
    const leftH = { row: -heading.col, col: heading.row };
    const rightH = { row: heading.col, col: -heading.row };
    const raw: Array<{ cell: GridCell; turned: boolean; step: GridCell }> = [];

    const consider = (step: GridCell, turned: boolean): void => {
      const cell = { row: prev.row + step.row, col: prev.col + step.col };
      if (this.canOccupy(occupancy, matrix, cell, path, head, direction, allowed)) {
        raw.push({ cell, turned, step });
      }
    };

    consider(heading, false);
    consider(leftH, true);
    consider(rightH, true);

    const unspooned = raw.filter(
      (option) => !this.isSameDirectionSpoon(occupancy, byId, option.cell, direction, path),
    );
    if (this.spoonStrict && unspooned.length === 0) return [];
    const usable = unspooned.length > 0 ? unspooned : raw;

    const prevDist = this.nearestManhattanCells(prev, magnetCells);
    const prevBonus = hitPrimary
      ? Number.POSITIVE_INFINITY
      : this.nearestManhattanKeys(prev, remainingBonus);

    const scored = usable.map((option) => {
      let score = rng.next() * 10;
      const key = this.key(option.cell);
      const nextDist = this.nearestManhattanCells(option.cell, magnetCells);
      if (Number.isFinite(prevDist) && Number.isFinite(nextDist)) {
        const pull = hitPrimary ? MAGNET_AFTER_PRIMARY : MAGNET_PER_CELL;
        score += pull * (prevDist - nextDist);
      }
      if (!hitPrimary && Number.isFinite(prevBonus)) {
        const nextBonus = this.nearestManhattanKeys(option.cell, remainingBonus);
        if (Number.isFinite(nextBonus)) {
          score += BONUS_CLIP_PULL * (prevBonus - nextBonus);
        }
      }

      const onPrimary = hunt.primary.has(key);
      const onBonus = remainingBonus.has(key);
      if (onPrimary && !hitPrimary) {
        const stepAxis: 'h' | 'v' = option.step.row === 0 ? 'h' : 'v';
        score += PRIMARY_CROSS;
        if (hunt.focusAxis && stepAxis !== hunt.focusAxis) score += 45;
        else if (hunt.focusAxis && stepAxis === hunt.focusAxis) score -= 70;
      }
      if (onBonus) score += MULTI_RAY_CROSS;

      if (
        option.cell.row >= hunt.centerRow0 &&
        option.cell.row < hunt.centerRow1 &&
        option.cell.col >= hunt.centerCol0 &&
        option.cell.col < hunt.centerCol1
      ) {
        score += hitPrimary ? CENTER_BIAS : CENTER_BIAS * 2;
      }

      const coil = this.coilScore(occupancy, path, prev, option.cell);
      score += hitPrimary ? coil : Math.round(coil * 0.15);
      const run = this.trailingRun(path, option.step) + 1;
      if (run >= 9) score -= 250;
      if (option.turned) {
        score += 8;
        if (
          inbound &&
          option.step.row === inbound.row &&
          option.step.col === inbound.col
        ) {
          score += 12;
        }
      }
      if (this.closesTwoByTwo(path, option.cell)) score -= 50;
      const weave = this.antiParallelScore(
        occupancy,
        byId,
        path,
        prev,
        option.cell,
        direction,
      );
      return { cell: option.cell, turned: option.turned, score, weave };
    });

    scored.sort((a, b) => b.score - a.score || b.weave - a.weave);
    if (
      scored.length >= 2 &&
      scored[0].score - scored[1].score < 14 &&
      scored[1].weave > scored[0].weave
    ) {
      [scored[0], scored[1]] = [scored[1], scored[0]];
    }
    return scored.map(({ cell, turned, score }) => ({ cell, turned, score }));
  }

  private findHeadCandidates(
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    direction: Direction,
    rayCells: Set<string>,
    frontierOnly: boolean,
    restrictToRay = false,
  ): HeadCandidate[] {
    const delta = DIRECTION_DELTA[direction];
    const candidates: HeadCandidate[] = [];

    const consider = (row: number, col: number): void => {
      if (matrix[row]?.[col] !== CELL_FLOOR || occupancy.cells[row][col] !== null) return;
      const cell = { row, col };
      const lane = this.laneLength(occupancy, matrix, row, col, delta);
      if (lane < 0) {
        if (!this.escapesOnceOccupantsLeave(occupancy, matrix, cell, direction)) return;
      } else if (this.countEmptyFloorAhead(occupancy, matrix, row, col, delta) === 0) {
        return;
      }
      if (frontierOnly && !this.isFrontier(occupancy, matrix, cell)) return;
      candidates.push({
        cell,
        lane,
        blocks: rayCells.has(this.key(cell)),
      });
    };

    if (restrictToRay && rayCells.size > 0) {
      for (const key of rayCells) {
        const [row, col] = key.split(',').map(Number);
        consider(row, col);
      }
      return candidates;
    }

    for (let row = 0; row < occupancy.rows; row++) {
      for (let col = 0; col < occupancy.cols; col++) {
        consider(row, col);
      }
    }

    return candidates;
  }

  /**
   * Empty heads far from the focus ray so the tail has to hunt across the map.
   * Random samples keep this cheaper than a full-grid scan on every placement.
   */
  private sampleHuntHeads(
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    direction: Direction,
    rayCells: Set<string>,
    rng: SeededRandom,
    maxLen: number,
  ): HeadCandidate[] {
    const rayPts = this.cellsFromKeys(rayCells);
    if (rayPts.length === 0) return [];
    const delta = DIRECTION_DELTA[direction];
    const found: HeadCandidate[] = [];
    const seen = new Set<string>();
    const maxGap = Math.max(HUNT_MIN_GAP + 1, maxLen - HUNT_BRANCH_RESERVE);
    for (let attempt = 0; attempt < 96 && found.length < 16; attempt++) {
      const sampled =
        attempt < 100 ? this.randomCellInUnbannedZone(rng, occupancy) : null;
      const row = sampled ? sampled.row : rng.nextInt(0, occupancy.rows - 1);
      const col = sampled ? sampled.col : rng.nextInt(0, occupancy.cols - 1);
      const key = `${row},${col}`;
      if (seen.has(key) || rayCells.has(key)) continue;
      seen.add(key);
      if (matrix[row]?.[col] !== CELL_FLOOR || occupancy.cells[row][col] !== null) continue;
      const gap = this.nearestManhattanCells({ row, col }, rayPts);
      if (gap < HUNT_MIN_GAP || gap > maxGap) continue;
      const cell = { row, col };
      if (this.zoneIsBanned(cell, occupancy) && attempt < 100) continue;
      const lane = this.laneLength(occupancy, matrix, row, col, delta);
      if (lane < 0) {
        if (!this.escapesOnceOccupantsLeave(occupancy, matrix, cell, direction)) continue;
      } else if (this.countEmptyFloorAhead(occupancy, matrix, row, col, delta) === 0) {
        continue;
      }
      found.push({ cell, lane, blocks: false });
    }
    return found;
  }

  private nearestBonusRayCells(tip: GridCell, remaining: Set<string>): GridCell[] {
    const cache = this.rays;
    if (!cache || remaining.size === 0) return [];
    let bestDist = Number.POSITIVE_INFINITY;
    let best: GridCell[] = [];
    for (const id of cache.unblocked) {
      const ray = cache.byId.get(id);
      if (!ray?.live) continue;
      const cells: GridCell[] = [];
      let dist = Number.POSITIVE_INFINITY;
      for (const key of ray.cellSet) {
        if (!remaining.has(key)) continue;
        const [row, col] = key.split(',').map(Number);
        cells.push({ row, col });
        const gap = Math.abs(row - tip.row) + Math.abs(col - tip.col);
        if (gap < dist) dist = gap;
      }
      if (cells.length === 0) continue;
      if (dist < bestDist) {
        bestDist = dist;
        best = cells;
      }
    }
    return best.length > 0 ? best : this.cellsFromKeys(remaining);
  }

  /**
   * Scatter away from recent heads, then prefer hunters far from the target
   * ray so the tail has to cross the board. On-ray heads stay as a fallback.
   */
  private orderHeads(
    candidates: HeadCandidate[],
    rng: SeededRandom,
    placed: ArrowDefinition[],
    occupancy: OccupancyGrid,
    rayCells: Set<string> = new Set(),
    maxLen = DEFAULT_MAX_ARROW_LENGTH,
  ): HeadCandidate[] {
    return this.orderHeadsUnfiltered(rng.shuffle(candidates), rng, placed, occupancy, rayCells, maxLen);
  }

  private orderHeadsUnfiltered(
    shuffled: HeadCandidate[],
    rng: SeededRandom,
    placed: ArrowDefinition[],
    occupancy: OccupancyGrid,
    rayCells: Set<string>,
    maxLen: number,
  ): HeadCandidate[] {
    if (placed.length === 0) {
      const long = [...shuffled].sort((a, b) => b.lane - a.lane);
      const pool = long.slice(0, Math.max(4, Math.ceil(long.length * 0.35)));
      return [...rng.shuffle(pool), ...rng.shuffle(long.slice(pool.length))];
    }

    const recent = this.recentHeads(placed, SCATTER_RECENT);
    const focused = rayCells.size > 0 && rayCells.size <= occupancy.rows + occupancy.cols;
    const rayPts = focused ? this.cellsFromKeys(rayCells) : [];
    const span = Math.max(occupancy.rows, occupancy.cols);
    const idealGap = Math.min(
      Math.max(HUNT_MIN_GAP + 2, maxLen - HUNT_BRANCH_RESERVE),
      Math.round(span * 0.45),
    );

    for (const minDist of [SCATTER_DIST_PRIMARY, SCATTER_DIST_FALLBACK, 0]) {
      const filtered =
        minDist === 0
          ? shuffled
          : shuffled.filter(
              (candidate) => this.minRecentDistance(candidate.cell, recent) >= minDist,
            );
      if (filtered.length === 0) continue;
      if (!focused) return filtered;
      const hunters = filtered
        .filter((candidate) => !candidate.blocks)
        .sort((a, b) => {
          const da = this.nearestManhattanCells(a.cell, rayPts);
          const db = this.nearestManhattanCells(b.cell, rayPts);
          return Math.abs(da - idealGap) - Math.abs(db - idealGap) || db - da;
        });
      const onRay = filtered.filter((candidate) => candidate.blocks);
      if (hunters.length === 0) return onRay;
      return [...hunters, ...onRay];
    }
    return shuffled;
  }

  private recentHeads(placed: ArrowDefinition[], count: number): GridCell[] {
    return placed.slice(-count).map((arrow) => arrow.cells[arrow.cells.length - 1]);
  }

  private minRecentDistance(cell: GridCell, recent: GridCell[]): number {
    if (recent.length === 0) return Number.POSITIVE_INFINITY;
    let best = Number.POSITIVE_INFINITY;
    for (const head of recent) {
      const dist = Math.abs(head.row - cell.row) + Math.abs(head.col - cell.col);
      if (dist < best) best = dist;
    }
    return best;
  }

  private trailingRun(path: GridCell[], step: GridCell): number {
    let run = 0;
    for (let i = path.length - 1; i > 0; i--) {
      const dr = path[i].row - path[i - 1].row;
      const dc = path[i].col - path[i - 1].col;
      if (dr !== step.row || dc !== step.col) break;
      run += 1;
    }
    return run;
  }

  private nearestManhattanCells(cell: GridCell, cells: GridCell[]): number {
    if (cells.length === 0) return Number.POSITIVE_INFINITY;
    let best = Number.POSITIVE_INFINITY;
    for (const other of cells) {
      const dist = Math.abs(other.row - cell.row) + Math.abs(other.col - cell.col);
      if (dist < best) best = dist;
    }
    return best;
  }

  private nearestManhattanKeys(cell: GridCell, keys: Set<string>): number {
    if (keys.size === 0) return Number.POSITIVE_INFINITY;
    let best = Number.POSITIVE_INFINITY;
    for (const key of keys) {
      const [row, col] = key.split(',').map(Number);
      const dist = Math.abs(row - cell.row) + Math.abs(col - cell.col);
      if (dist < best) best = dist;
    }
    return best;
  }

  /** Drop every remaining bonus cell that belongs to the same ray as `key`. */
  private consumeRayAt(key: string, remaining: Set<string>): void {
    remaining.delete(key);
    const cache = this.rays;
    const owners = cache?.cellToIds.get(key);
    if (!cache || !owners) return;
    for (const id of owners) {
      const ray = cache.byId.get(id);
      if (!ray) continue;
      for (const cell of ray.cellSet) remaining.delete(cell);
    }
  }

  private axisOf(direction: Direction): 'h' | 'v' {
    return direction === 'left' || direction === 'right' ? 'h' : 'v';
  }

  private rayAxis(rayCells: Set<string>): 'h' | 'v' | null {
    if (rayCells.size === 0) return null;
    let row: number | null = null;
    let col: number | null = null;
    let sameRow = true;
    let sameCol = true;
    for (const key of rayCells) {
      const [r, c] = key.split(',').map(Number);
      if (row === null) row = r;
      if (col === null) col = c;
      if (r !== row) sameRow = false;
      if (c !== col) sameCol = false;
      if (!sameRow && !sameCol) return null;
    }
    if (sameRow && !sameCol) return 'h';
    if (sameCol && !sameRow) return 'v';
    return null;
  }

  /**
   * Reward weaving beside a perpendicular or opposite-facing neighbour.
   * Same-escape spoons are already rejected; leftover contacts still get a
   * heavy penalty so scoring never prefers them.
   */
  private antiParallelScore(
    occupancy: OccupancyGrid,
    byId: Map<string, ArrowDefinition>,
    path: GridCell[],
    prev: GridCell,
    cell: GridCell,
    direction: Direction,
  ): number {
    let score = 0;
    for (const side of this.alongsideOffsets(direction)) {
      const nr = cell.row + side.row;
      const nc = cell.col + side.col;
      if (nr === prev.row && nc === prev.col) continue;
      if (!this.isInside(occupancy, nr, nc)) continue;
      if (path.some((p) => p.row === nr && p.col === nc)) continue;
      const id = occupancy.cells[nr][nc];
      if (!id) continue;
      const other = byId.get(id);
      if (!other) continue;
      if (other.direction === direction) score -= SPOON_PENALTY;
      else if (other.direction === this.oppositeDirection(direction)) score += 140;
      else score += 90;
    }
    return score;
  }

  /** Neighbours offset perpendicular to an escape axis (stacked, not nose-to-tail). */
  private alongsideOffsets(direction: Direction): GridCell[] {
    return this.axisOf(direction) === 'h'
      ? [
          { row: 1, col: 0 },
          { row: -1, col: 0 },
        ]
      : [
          { row: 0, col: 1 },
          { row: 0, col: -1 },
        ];
  }

  private oppositeDirection(direction: Direction): Direction {
    if (direction === 'up') return 'down';
    if (direction === 'down') return 'up';
    if (direction === 'left') return 'right';
    return 'left';
  }

  /**
   * True when `cell` sits beside another arrow that shares this escape
   * direction — the unzipping / spoon configuration.
   */
  private isSameDirectionSpoon(
    occupancy: OccupancyGrid,
    byId: Map<string, ArrowDefinition>,
    cell: GridCell,
    direction: Direction,
    ignorePath: GridCell[] = [],
  ): boolean {
    for (const side of this.alongsideOffsets(direction)) {
      const nr = cell.row + side.row;
      const nc = cell.col + side.col;
      if (ignorePath.some((p) => p.row === nr && p.col === nc)) continue;
      if (!this.isInside(occupancy, nr, nc)) continue;
      const id = occupancy.cells[nr][nc];
      if (!id) continue;
      const other = byId.get(id);
      if (other && other.direction === direction) return true;
    }
    return false;
  }

  /** Prefer a real slide over an instant hop off the rim. */
  private orderCrumbDirections(
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    head: GridCell,
    rng: SeededRandom,
  ): Direction[] {
    const shuffled = rng.shuffle(ALL_DIRECTIONS);
    const deep: Direction[] = [];
    const cheap: Direction[] = [];
    for (const direction of shuffled) {
      const lane = this.laneLength(
        occupancy,
        matrix,
        head.row,
        head.col,
        DIRECTION_DELTA[direction],
      );
      if (this.isCheapExit(lane)) cheap.push(direction);
      else deep.push(direction);
    }
    return [...deep, ...cheap];
  }

  private isCheapExit(lane: number): boolean {
    return lane >= 0 && lane <= CHEAP_EXIT_LANE;
  }

  /** Empty cell touching the occupied blob or the silhouette edge. */
  private isFrontier(
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    cell: GridCell,
  ): boolean {
    for (const step of [
      { row: 1, col: 0 },
      { row: -1, col: 0 },
      { row: 0, col: 1 },
      { row: 0, col: -1 },
    ]) {
      const row = cell.row + step.row;
      const col = cell.col + step.col;
      if (!this.isInside(occupancy, row, col)) return true;
      if (matrix[row][col] !== CELL_FLOOR) return true;
      if (occupancy.cells[row][col] !== null) return true;
    }
    return false;
  }

  /**
   * Connected empty patches after stripping currently-escapable rays.
   * Inner approach lanes of blocked arrows stay in the pocket so they can pack.
   */
  private offRayGroups(region: GridCell[], liveRays: Set<string>): GridCell[][] {
    return this.connectedGroups(region.filter((cell) => !liveRays.has(this.key(cell))));
  }

  private connectedGroups(cells: GridCell[]): GridCell[][] {
    const byKey = new Map<string, GridCell>();
    for (const cell of cells) byKey.set(this.key(cell), cell);
    const seen = new Set<string>();
    const groups: GridCell[][] = [];

    for (const start of cells) {
      const startKey = this.key(start);
      if (seen.has(startKey)) continue;
      const group: GridCell[] = [];
      const stack = [start];
      seen.add(startKey);
      while (stack.length > 0) {
        const cell = stack.pop()!;
        group.push(cell);
        for (const step of [
          { row: 1, col: 0 },
          { row: -1, col: 0 },
          { row: 0, col: 1 },
          { row: 0, col: -1 },
        ]) {
          const next = { row: cell.row + step.row, col: cell.col + step.col };
          const nextKey = this.key(next);
          if (seen.has(nextKey) || !byKey.has(nextKey)) continue;
          seen.add(nextKey);
          stack.push(next);
        }
      }
      groups.push(group);
    }

    return groups;
  }

  private bodyHits(cells: GridCell[], rayCells: Set<string>, head: GridCell): boolean {
    return cells.some(
      (cell) =>
        (cell.row !== head.row || cell.col !== head.col) && rayCells.has(this.key(cell)),
    );
  }

  private growTails(
    arrows: ArrowDefinition[],
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    maxLength: number,
    _rng?: SeededRandom,
  ): void {
    if (arrows.length === 0) return;
    const snapshot = arrows.map((arrow) => arrow.cells.map((cell) => ({ ...cell })));
    const before = this.totalCells(arrows);
    this.fillPass(arrows, occupancy, matrix, maxLength);
    if (this.totalCells(arrows) === before) return;
    if (this.removalOrder(arrows, occupancy, matrix)) {
      this.rebuildAllRays(arrows, occupancy, matrix);
      return;
    }
    for (let index = 0; index < arrows.length; index++) {
      this.uncommitCells(occupancy, arrows[index].cells);
      arrows[index].cells = snapshot[index];
      this.commitArrow(occupancy, arrows[index]);
    }
    this.rebuildAllRays(arrows, occupancy, matrix);
  }

  private fillPass(
    arrows: ArrowDefinition[],
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    maxLength: number,
  ): void {
    const lastRayOwner = this.buildRayOwnership(arrows, occupancy, matrix);
    const byId = new Map(arrows.map((arrow) => [arrow.id, arrow]));
    let grew = true;
    while (grew) {
      grew = false;
      for (let row = 0; row < occupancy.rows; row++) {
        for (let col = 0; col < occupancy.cols; col++) {
          if (matrix[row][col] !== CELL_FLOOR) continue;
          if (occupancy.cells[row][col] !== null) continue;
          const claimant = this.tailClaimantFor(
            row,
            col,
            arrows,
            occupancy,
            byId,
            lastRayOwner[row][col],
            maxLength,
          );
          if (claimant === null) continue;
          claimant.cells.unshift({ row, col });
          occupancy.cells[row][col] = claimant.id;
          grew = true;
        }
      }
    }
  }

  private tailClaimantFor(
    row: number,
    col: number,
    arrows: ArrowDefinition[],
    occupancy: OccupancyGrid,
    byId: Map<string, ArrowDefinition>,
    lastRayOwner: number,
    maxLength: number,
  ): ArrowDefinition | null {
    for (let index = arrows.length - 1; index > lastRayOwner; index--) {
      const arrow = arrows[index];
      if (arrow.cells.length >= maxLength) continue;
      const head = arrow.cells[arrow.cells.length - 1];
      if (this.isOnEscapeRay({ row, col }, head, arrow.direction)) continue;
      const tail = arrow.cells[0];
      if (Math.abs(tail.row - row) + Math.abs(tail.col - col) !== 1) continue;
      if (this.tailWouldStripe(arrow, { row, col })) continue;
      if (this.spoonStrict && this.isSameDirectionSpoon(occupancy, byId, { row, col }, arrow.direction)) {
        continue;
      }
      return arrow;
    }
    return null;
  }

  private buildRayOwnership(
    arrows: ArrowDefinition[],
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
  ): number[][] {
    const owners = Array.from({ length: occupancy.rows }, () =>
      Array<number>(occupancy.cols).fill(-1),
    );

    arrows.forEach((arrow, index) => {
      const delta = DIRECTION_DELTA[arrow.direction];
      const head = arrow.cells[arrow.cells.length - 1];
      let row = head.row + delta.row;
      let col = head.col + delta.col;
      while (this.isInside(occupancy, row, col)) {
        if (matrix[row][col] === CELL_FLOOR) {
          owners[row][col] = Math.max(owners[row][col], index);
        }
        row += delta.row;
        col += delta.col;
      }
    });

    return owners;
  }

  private removalOrder(
    arrows: ArrowDefinition[],
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    rng?: SeededRandom,
  ): ArrowDefinition[] | null {
    const remaining = [...arrows];
    const order: ArrowDefinition[] = [];
    const working: OccupancyGrid = {
      rows: occupancy.rows,
      cols: occupancy.cols,
      cells: occupancy.cells.map((row) => row.slice()),
    };

    while (remaining.length > 0) {
      let index = -1;
      if (rng) {
        const ready: number[] = [];
        remaining.forEach((arrow, i) => {
          const head = arrow.cells[arrow.cells.length - 1];
          if (
            this.hasClearRayToEdge(
              working,
              matrix,
              head.row,
              head.col,
              DIRECTION_DELTA[arrow.direction],
              arrow.id,
            )
          ) {
            ready.push(i);
          }
        });
        if (ready.length === 0) return null;
        index = rng.pick(ready);
      } else {
        for (let i = 0; i < remaining.length; i++) {
          const arrow = remaining[i];
          const head = arrow.cells[arrow.cells.length - 1];
          if (
            this.hasClearRayToEdge(
              working,
              matrix,
              head.row,
              head.col,
              DIRECTION_DELTA[arrow.direction],
              arrow.id,
            )
          ) {
            index = i;
            break;
          }
        }
        if (index < 0) return null;
      }
      const [escaped] = remaining.splice(index, 1);
      for (const cell of escaped.cells) working.cells[cell.row][cell.col] = null;
      order.push(escaped);
    }

    return order;
  }

  private laneLength(
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    startRow: number,
    startCol: number,
    delta: GridCell,
    ignoreId?: string,
  ): number {
    let row = startRow + delta.row;
    let col = startCol + delta.col;
    let steps = 1;

    while (this.isInside(occupancy, row, col)) {
      if (matrix[row][col] === CELL_BLOCKER) return -1;
      const occupant = occupancy.cells[row][col];
      if (occupant !== null && occupant !== ignoreId) return -1;
      steps++;
      row += delta.row;
      col += delta.col;
    }

    return steps;
  }

  /**
   * Counts how many unallocated floor cells exist along the forward escape ray.
   * If this returns 0, no future arrow can ever block this piece.
   */
  private countEmptyFloorAhead(
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    startRow: number,
    startCol: number,
    delta: GridCell,
  ): number {
    let row = startRow + delta.row;
    let col = startCol + delta.col;
    let emptyCount = 0;

    while (this.isInside(occupancy, row, col)) {
      if (matrix[row][col] === CELL_BLOCKER || matrix[row][col] === CELL_OUTSIDE) break;
      if (matrix[row][col] === CELL_FLOOR && occupancy.cells[row][col] === null) {
        emptyCount++;
      }
      row += delta.row;
      col += delta.col;
    }

    return emptyCount;
  }

  private hasClearRayToEdge(
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    startRow: number,
    startCol: number,
    delta: GridCell,
    ignoreId?: string,
  ): boolean {
    return this.laneLength(occupancy, matrix, startRow, startCol, delta, ignoreId) >= 0;
  }

  private canOccupy(
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    cell: GridCell,
    currentPath: GridCell[],
    head?: GridCell,
    direction?: Direction,
    allowed?: Set<string> | null,
  ): boolean {
    if (!this.isInside(occupancy, cell.row, cell.col)) return false;
    if (matrix[cell.row][cell.col] !== CELL_FLOOR) return false;
    if (occupancy.cells[cell.row][cell.col] !== null) return false;
    if (allowed && !allowed.has(this.key(cell))) return false;
    if (currentPath.some((p) => p.row === cell.row && p.col === cell.col)) return false;
    if (head && direction && this.isOnEscapeRay(cell, head, direction)) return false;
    return true;
  }

  private isOnEscapeRay(cell: GridCell, head: GridCell, direction: Direction): boolean {
    const delta = DIRECTION_DELTA[direction];
    if (delta.row !== 0) {
      return cell.col === head.col && Math.sign(cell.row - head.row) === delta.row;
    }
    return cell.row === head.row && Math.sign(cell.col - head.col) === delta.col;
  }

  private occupiedNeighbourCount(
    occupancy: OccupancyGrid,
    path: GridCell[],
    prev: GridCell,
    cell: GridCell,
  ): number {
    let count = 0;
    for (const step of [
      { row: 1, col: 0 },
      { row: -1, col: 0 },
      { row: 0, col: 1 },
      { row: 0, col: -1 },
    ]) {
      const row = cell.row + step.row;
      const col = cell.col + step.col;
      if (row === prev.row && col === prev.col) continue;
      if (!this.isInside(occupancy, row, col)) continue;
      if (occupancy.cells[row][col] !== null) {
        count += 1;
        continue;
      }
      if (path.some((p) => p.row === row && p.col === col)) count += 1;
    }
    return count;
  }

  /**
   * Prefer wrapping a corner (2+ occupied/own-body neighbours) over running
   * parallel to a single wall. Diagonal contacts count as spiral tightness.
   */
  private coilScore(
    occupancy: OccupancyGrid,
    path: GridCell[],
    prev: GridCell,
    cell: GridCell,
  ): number {
    const ortho = this.occupiedNeighbourCount(occupancy, path, prev, cell);
    let diag = 0;
    for (const step of [
      { row: 1, col: 1 },
      { row: 1, col: -1 },
      { row: -1, col: 1 },
      { row: -1, col: -1 },
    ]) {
      const row = cell.row + step.row;
      const col = cell.col + step.col;
      if (!this.isInside(occupancy, row, col)) continue;
      if (occupancy.cells[row][col] !== null) {
        diag += 1;
        continue;
      }
      if (path.some((p) => p.row === row && p.col === col)) diag += 1;
    }
    let score = ortho * 38 + diag * 14;
    if (ortho >= 2) score += 40;
    else if (ortho === 1) score += 6;
    return score;
  }

  /** True when claiming this cell would continue a long straight tail. */
  private tailWouldStripe(arrow: ArrowDefinition, cell: GridCell): boolean {
    const tail = arrow.cells[0];
    const step = { row: cell.row - tail.row, col: cell.col - tail.col };
    let run = 1;
    for (let index = 1; index < arrow.cells.length; index++) {
      const prev = arrow.cells[index - 1];
      const next = arrow.cells[index];
      if (prev.row - next.row !== step.row || prev.col - next.col !== step.col) break;
      run += 1;
      if (run >= STRAIGHT_CAP_MAX) return true;
    }
    return false;
  }

  private rollSnakeMax(
    rng: SeededRandom,
    cap: number,
    isFirst: boolean,
    preferLong = false,
  ): number {
    const hi = Math.max(SNAKE_MIN_CAP, cap);
    if (isFirst) return Math.min(SNAKE_LONG_CAP, hi);
    const roll = rng.next();
    if (preferLong) {
      if (roll < 0.08) return Math.min(12, hi);
      if (roll < 0.28) return Math.min(20, hi);
      if (roll < 0.55) return Math.min(36, hi);
      return Math.min(SNAKE_LONG_CAP, hi);
    }
    if (roll < 0.18) return Math.min(SNAKE_MIN_CAP, hi);
    if (roll < 0.4) return Math.min(12, hi);
    if (roll < 0.68) return Math.min(20, hi);
    return Math.min(SNAKE_LONG_CAP, hi);
  }

  /** Cross-board blockers need a length floor that scales with the silhouette. */
  private snakeReachCap(occupancy: OccupancyGrid, maxLen: number): number {
    const span = Math.max(occupancy.rows, occupancy.cols);
    const reach = Math.max(24, Math.round(span * 0.7));
    return Math.max(maxLen, Math.min(SNAKE_LONG_CAP, reach));
  }

  private commitArrow(occupancy: OccupancyGrid, arrow: ArrowDefinition): void {
    for (const cell of arrow.cells) occupancy.cells[cell.row][cell.col] = arrow.id;
  }

  private totalCells(arrows: ArrowDefinition[]): number {
    return arrows.reduce((sum, arrow) => sum + arrow.cells.length, 0);
  }

  private key(cell: GridCell): string {
    return `${cell.row},${cell.col}`;
  }

  private closesTwoByTwo(path: GridCell[], cell: GridCell): boolean {
    const onPath = (row: number, col: number): boolean =>
      path.some((p) => p.row === row && p.col === col);
    for (const dr of [-1, 1]) {
      for (const dc of [-1, 1]) {
        if (
          onPath(cell.row + dr, cell.col) &&
          onPath(cell.row, cell.col + dc) &&
          onPath(cell.row + dr, cell.col + dc)
        ) {
          return true;
        }
      }
    }
    return false;
  }

  private countFloorCells(matrix: CellValue[][]): number {
    let count = 0;
    for (const row of matrix) {
      for (const cell of row) if (cell === CELL_FLOOR) count++;
    }
    return count;
  }

  private resolveInteriorSize(sLevelIndex: number, override?: number): number {
    const size = override ?? MIN_INTERIOR + Math.floor(sLevelIndex / 40);
    return Math.min(MAX_INTERIOR, Math.max(MIN_INTERIOR, size));
  }

  private createBorderedMatrix(interiorSize: number): CellValue[][] {
    const total = interiorSize + 2;
    const matrix: CellValue[][] = [];
    for (let r = 0; r < total; r++) {
      const row: CellValue[] = [];
      for (let c = 0; c < total; c++) {
        const isBorder = r === 0 || c === 0 || r === total - 1 || c === total - 1;
        row.push(isBorder ? CELL_OUTSIDE : CELL_FLOOR);
      }
      matrix.push(row);
    }
    return matrix;
  }

  private createOccupancy(rows: number, cols: number): OccupancyGrid {
    return {
      rows,
      cols,
      cells: Array.from({ length: rows }, () => Array<string | null>(cols).fill(null)),
    };
  }

  private isInside(grid: OccupancyGrid, row: number, col: number): boolean {
    return row >= 0 && col >= 0 && row < grid.rows && col < grid.cols;
  }

  private noteHeadZone(arrow: ArrowDefinition, occupancy: OccupancyGrid): void {
    if (this.bannedRemaining > 0) this.bannedRemaining -= 1;
    const head = arrow.cells[arrow.cells.length - 1];
    const zone = this.zoneIndex(head, occupancy);
    if (this.bannedRemaining <= 0 || this.bannedZone === null) {
      this.bannedZone = zone;
      this.bannedRemaining = ZONE_BAN_PLACEMENTS;
    }
  }

  private zoneIndex(cell: GridCell, occupancy: OccupancyGrid): number {
    const rowBand = Math.min(
      ZONE_DIVISIONS - 1,
      Math.floor((cell.row * ZONE_DIVISIONS) / Math.max(1, occupancy.rows)),
    );
    const colBand = Math.min(
      ZONE_DIVISIONS - 1,
      Math.floor((cell.col * ZONE_DIVISIONS) / Math.max(1, occupancy.cols)),
    );
    return rowBand * ZONE_DIVISIONS + colBand;
  }

  private zoneIsBanned(cell: GridCell, occupancy: OccupancyGrid): boolean {
    if (!this.zoneBanActive || this.bannedZone === null || this.bannedRemaining <= 0) return false;
    return this.zoneIndex(cell, occupancy) === this.bannedZone;
  }

  private filterHeadsByZone(heads: HeadCandidate[], occupancy: OccupancyGrid): HeadCandidate[] {
    if (!this.zoneBanActive || this.bannedZone === null || this.bannedRemaining <= 0) return heads;
    return heads.filter((head) => this.zoneIndex(head.cell, occupancy) !== this.bannedZone);
  }

  private resetDirectionQuota(): void {
    const zones = ZONE_DIVISIONS * ZONE_DIVISIONS;
    this.zoneDirCounts = Array.from({ length: zones }, () => [0, 0, 0, 0]);
    this.zoneDirTotals = Array.from({ length: zones }, () => 0);
  }

  private dirIndex(direction: Direction): number {
    if (direction === 'up') return 0;
    if (direction === 'down') return 1;
    if (direction === 'left') return 2;
    return 3;
  }

  private recordDirectionQuota(
    arrow: ArrowDefinition,
    occupancy: OccupancyGrid,
    delta = 1,
  ): void {
    if (arrow.role === 'crumb') return;
    if (this.zoneDirTotals.length === 0) this.resetDirectionQuota();
    const head = arrow.cells[arrow.cells.length - 1];
    const zone = this.zoneIndex(head, occupancy);
    const dir = this.dirIndex(arrow.direction);
    this.zoneDirCounts[zone][dir] = Math.max(0, this.zoneDirCounts[zone][dir] + delta);
    this.zoneDirTotals[zone] = Math.max(0, this.zoneDirTotals[zone] + delta);
  }

  private directionQuotaBanned(zone: number, direction: Direction): boolean {
    const total = this.zoneDirTotals[zone] ?? 0;
    if (total < DIR_QUOTA_MIN) return false;
    const count = this.zoneDirCounts[zone]?.[this.dirIndex(direction)] ?? 0;
    return count / total > DIR_QUOTA;
  }

  private filterHeadsByQuota(
    heads: HeadCandidate[],
    occupancy: OccupancyGrid,
    direction: Direction,
  ): HeadCandidate[] {
    if (!this.quotaActive || this.zoneDirTotals.length === 0) return heads;
    return heads.filter(
      (head) => !this.directionQuotaBanned(this.zoneIndex(head.cell, occupancy), direction),
    );
  }

  private randomCellInUnbannedZone(rng: SeededRandom, occupancy: OccupancyGrid): GridCell | null {
    const total = ZONE_DIVISIONS * ZONE_DIVISIONS;
    const allowed: number[] = [];
    for (let zone = 0; zone < total; zone++) {
      if (this.zoneBanActive && this.bannedZone === zone && this.bannedRemaining > 0) continue;
      allowed.push(zone);
    }
    if (allowed.length === 0) return null;
    const zone = rng.pick(allowed);
    const rowBand = Math.floor(zone / ZONE_DIVISIONS);
    const colBand = zone % ZONE_DIVISIONS;
    const row0 = Math.floor((rowBand * occupancy.rows) / ZONE_DIVISIONS);
    const row1 = Math.max(row0, Math.floor(((rowBand + 1) * occupancy.rows) / ZONE_DIVISIONS) - 1);
    const col0 = Math.floor((colBand * occupancy.cols) / ZONE_DIVISIONS);
    const col1 = Math.max(col0, Math.floor(((colBand + 1) * occupancy.cols) / ZONE_DIVISIONS) - 1);
    return { row: rng.nextInt(row0, row1), col: rng.nextInt(col0, col1) };
  }

  private inferDifficulty(occupiedCells: number, floorCells: number): Difficulty {
    const density = floorCells === 0 ? 0 : occupiedCells / floorCells;
    if (density < 0.18) return 'easy';
    if (density < 0.32) return 'medium';
    return 'hard';
  }
}

function resolveGenerationSeed(options: SLevelGeneratorOptions): number {
  if (options.forceRandomize) {
    const salt = options.randomSalt ?? freshEntropy();
    return mixSeed(options.sLevelIndex, salt);
  }
  if (options.randomSalt !== undefined) {
    return mixSeed(options.seed ?? options.sLevelIndex, options.randomSalt);
  }
  return (options.seed ?? options.sLevelIndex) >>> 0;
}

function freshEntropy(): number {
  const now = Date.now() >>> 0;
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const bytes = new Uint32Array(1);
    cryptoObj.getRandomValues(bytes);
    return (now ^ bytes[0]) >>> 0;
  }
  return (now ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

function mixSeed(index: number, salt: number): number {
  let hash = Math.imul(index >>> 0, 0x9e3779b1);
  hash ^= salt >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function generateSLevel(
  sLevelIndex: number,
  seed?: number,
  extras?: Pick<SLevelGeneratorOptions, 'forceRandomize' | 'randomSalt'>,
): Level {
  return new SLevelGenerator().generate({ sLevelIndex, seed, ...extras });
}

/** Pack leftover floor on an existing board using the generator's fill passes. */
export function fillLevelVacancies(level: Level, seed?: number): Level {
  return new SLevelGenerator().fillVacancies(level, seed);
}
