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

export type GenerationQuality = 'fast' | 'normal' | 'quality';

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
  /**
   * Speed / density trade: fast finishes sooner; quality spends longer on teal+pink packing.
   */
  quality?: GenerationQuality;
}

interface QualityKnobs {
  coreTarget: number;
  packTarget: number;
  fillTarget: number;
  maxCrumbShare: number;
  maxAttemptsCap: number;
  saturationRetries: number;
  packFailBudgetScale: number;
  extraPackPasses: boolean;
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

interface MacroBlock {
  id: number;
  row: number;
  col: number;
  radius: number;
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

const CORE_COVERAGE = 0.88;
const DEFAULT_S_DENSITY = CORE_COVERAGE;
const FILL_TARGET = 0.95;
/** Pink hole-packing stops here; leftover floor is purple crumbs. */
const PACK_TARGET = 0.88;
/** Immediately clickable arrows allowed at solve step 1. */
const MAX_OPENING_MOVES = 2;
/** Heads may sit this many cells past the block radius when it helps packing. */
const HEAD_RADIUS_SLACK = 5;
/** Soft border slack for body steps that stay near the home Voronoi face. */
const FOREIGN_OVERLAP = 4;

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

const CORE_SATURATION_RETRIES = 80;
const FILLER_QUICK_ATTEMPTS = 16;
const FILLER_LONG_MIN = 6;
const FILLER_LONG_MAX = 12;
/** Shortest snake allowed when the pack pass relaxes — never below 5. */
const FILLER_RELAX_MIN = 5;
/** Pink tails may not keep growing past this — stops “length for length’s sake”. */
const FILLER_TAIL_CAP = 14;
/** Reject / heavily penalize steps that hug the snake’s own body (fake self-blocks). */
const SELF_HUG_PENALTY = 520;

/** Board density above which final snakes hunt harder across the map. */
const ENDGAME_DENSITY = 0.8;
const ENDGAME_MAGNET_AMP = 3;

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
const DIR_QUOTA_MIN = 3;
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
const BRIDGE_PULL = 160;
/** Keep a core body inside its home block; a short seam overlap is allowed. */
const HOME_STAY = 110;
const FOREIGN_STEP_PENALTY = 120;

interface RayHunt {
  primary: Set<string>;
  primaryCells: GridCell[];
  bonus: Set<string>;
  focusAxis: 'h' | 'v' | null;
  /** True when this hunt is a cross-block bridge after a round-robin jump. */
  bridge: boolean;
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
 * stacking a same-direction jam. Core heads are soft-bordered into 2–7
 * geographic macro-blocks and placed in round-robin micro-clusters of 1–5
 * arrows, so generation never depletes one zone in a single visit. Heads
 * stay near that block's origin (with a few cells of slack) and bodies prefer
 * home territory; a tail may cross a neighbour so long as the previous arrow
 * in that block did not. After each jump the first new piece hunts a nearby
 * foreign-block ray. Bodies refuse to run alongside a neighbour that shares the
 * same escape direction (anti-spoon). Each quadrant bans an escape heading
 * that already holds more than 30% of its heads, so fillers cannot spam
 * the nearest border. Scattered heads hunt the chosen ray across the
 * board, then keep growing to clip extra rays so one piece can lock
 * several paths. Tails prefer the middle of the silhouette, so bodies
 * knot in the centre instead of hugging the rim. One forward pass builds
 * the board; leftover holes are packed with pink fillers that still obey
 * cheap-exit / direction / spoon rules, then a winding mop-up (≥5 cells)
 * pushes density toward fillTarget — never tiny purple crumbs. At most two
 * arrows may be free on the first click. Heads sitting on the rim may not
 * point straight off the board.
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
  /** Vein rule: reject snakes that carve pockets smaller than FILLER_RELAX_MIN. */
  private enforceVein = true;
  private macroBlocks: MacroBlock[] = [];
  private macroRobinIndex = 0;
  private activeBlockId: number | null = null;
  private lastVisitedBlockId: number | null = null;
  private lastCommittedBlockId: number | null = null;
  private clusterBudget = 0;
  private clusterPlaced = 0;
  private pendingBridgeRay: Set<string> | null = null;
  private bridgeHuntActive = false;
  private macroRadiusCap = 12;
  /** True when the last committed arrow in the active block crossed a border. */
  private lastBlockCrossedBorder = false;
  private quality: QualityKnobs = qualityKnobs('normal');

  generate(options: SLevelGeneratorOptions): Level {
    const { sLevelIndex } = options;
    const seed = resolveGenerationSeed(options);
    this.quality = qualityKnobs(options.quality ?? 'quality');

    const matrix = options.shapeMatrix
      ? options.shapeMatrix.map((row) => [...row])
      : this.createBorderedMatrix(this.resolveInteriorSize(sLevelIndex, options.gridSize));

    const floorCells = this.countFloorCells(matrix);
    const density = options.targetDensity ?? Math.min(DEFAULT_S_DENSITY, this.quality.coreTarget);
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
    built.level.metadata.seed = seed;
    return built.level;
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
    const targetOccupiedCells = Math.floor(floorCells * Math.min(density, this.quality.coreTarget));
    this.rays = this.emptyRayCache();
    this.zoneBanActive = true;
    this.bannedZone = null;
    this.bannedRemaining = 0;
    this.resetDirectionQuota();
    this.quotaActive = true;
    this.spoonStrict = true;
    this.enforceVein = true;
    this.lastBlockCrossedBorder = false;
    this.setupMacroBlocks(occupancy, matrix, rng);

    const arrows: ArrowDefinition[] = [];
    let nextIndex = 0;

    const maxAttempts = Math.max(
      120,
      Math.min(this.quality.maxAttemptsCap, Math.floor(floorCells * (this.quality.maxAttemptsCap > 400 ? 4 : 2.2))),
    );
    let attempts = 0;
    let consecutiveFailures = 0;
    let visitFails = 0;
    const saturation = this.quality.saturationRetries;

    while (
      (this.totalCells(arrows) < targetOccupiedCells || arrows.length < minArrows) &&
      attempts < maxAttempts
    ) {
      attempts++;
      const isFirst = arrows.length === 0;
      const requireBlock = !isFirst && consecutiveFailures < 12;
      const frontierOnly = consecutiveFailures < 16;
      this.zoneBanActive = consecutiveFailures < 4;
      this.quotaActive = true;
      const jumped = this.rollMacroCluster(rng, arrows, occupancy, matrix, visitFails);
      if (jumped) {
        visitFails = 0;
        this.lastBlockCrossedBorder = false;
      }
      if (visitFails > 0) this.expandActiveBlockRadius();
      const enforceMacro = this.activeBlockId !== null && visitFails < (this.quality.packFailBudgetScale < 0.65 ? 2 : 6);
      const bridging =
        enforceMacro && visitFails < 3 && !!this.pendingBridgeRay && this.pendingBridgeRay.size > 0;
      this.bridgeHuntActive = bridging;
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
        {
          requireBlock: bridging || requireBlock,
          frontierOnly: bridging ? false : frontierOnly,
          allowCheap: consecutiveFailures >= 20,
          allowLive: false,
          hunt: true,
          blockId: enforceMacro ? this.activeBlockId ?? undefined : undefined,
          bridgeRay: bridging ? this.pendingBridgeRay ?? undefined : undefined,
        },
      );

      if (!candidate) {
        visitFails++;
        if (++consecutiveFailures >= saturation) break;
        continue;
      }
      if (!this.tryCommit(arrows, occupancy, matrix, candidate)) {
        visitFails++;
        if (++consecutiveFailures >= saturation) break;
        continue;
      }
      this.noteHeadZone(candidate, occupancy);
      this.noteMacroCommit(candidate);
      nextIndex++;
      consecutiveFailures = 0;
      visitFails = 0;
    }

    this.growTails(arrows, occupancy, matrix, Math.max(maxTail, this.snakeReachCap(occupancy, maxLen)), rng);
    this.rebuildAllRays(arrows, occupancy, matrix);
    const coreCoverage = floorCells === 0 ? 1 : this.totalCells(arrows) / floorCells;

    this.packHoles(arrows, occupancy, matrix, rng, maxLen, maxTail);
    this.fillEmptyRegions(arrows, occupancy, matrix, rng, maxTail, 0, maxLen);
    if (this.quality.extraPackPasses) {
      this.packHoles(arrows, occupancy, matrix, rng, maxLen, maxTail, arrows.length + 80_000);
      this.fillEmptyRegions(arrows, occupancy, matrix, rng, maxTail, arrows.length + 82_000, maxLen);
    }
    this.fillWindingGaps(arrows, occupancy, matrix, rng, maxTail, arrows.length + 90_000);
    if (floorCells > 0 && this.totalCells(arrows) / floorCells < this.quality.fillTarget - 0.02) {
      this.fillWindingGaps(arrows, occupancy, matrix, rng, maxTail, arrows.length + 95_000);
    }
    if (floorCells > 0 && this.totalCells(arrows) / floorCells < this.quality.fillTarget - 0.03) {
      this.rescueDeadVoids(arrows, occupancy, matrix, rng, maxLen, maxTail);
    }
    this.popUntilSolvable(arrows, occupancy, matrix);
    this.clampOpenings(arrows, occupancy, matrix, rng);
    const occupiedCells = this.totalCells(arrows);
    const grid: LevelGrid = { rows, cols, matrix };
    const solved = this.removalOrder(arrows, occupancy, matrix);
    this.assignSolveIndices(arrows, solved ?? undefined);
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
    this.quality = qualityKnobs('normal');
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
    this.quotaActive = false;
    this.spoonStrict = false;
    this.macroBlocks = [];
    this.macroRobinIndex = 0;
    this.activeBlockId = null;
    this.lastVisitedBlockId = null;
    this.lastCommittedBlockId = null;
    this.clusterBudget = 0;
    this.clusterPlaced = 0;
    this.pendingBridgeRay = null;
    this.bridgeHuntActive = false;

    const rng = new SeededRandom(seed ?? (level.metadata.seed ?? 1) * 1_000_003 + arrows.length + 17);
    const serial = arrows.length + 10_000;
    this.packHoles(arrows, occupancy, matrix, rng, DEFAULT_MAX_ARROW_LENGTH, DEFAULT_MAX_TAIL_LENGTH, serial);
    this.fillEmptyRegions(arrows, occupancy, matrix, rng, DEFAULT_MAX_TAIL_LENGTH, serial, DEFAULT_MAX_ARROW_LENGTH);
    this.fillWindingGaps(
      arrows,
      occupancy,
      matrix,
      rng,
      DEFAULT_MAX_TAIL_LENGTH,
      serial + 20_000,
    );
    if (this.countFloorCells(matrix) > 0) {
      let dens = this.totalCells(arrows) / this.countFloorCells(matrix);
      if (dens < this.quality.fillTarget - 0.02) {
        this.fillWindingGaps(
          arrows,
          occupancy,
          matrix,
          rng,
          DEFAULT_MAX_TAIL_LENGTH,
          serial + 25_000,
        );
        dens = this.totalCells(arrows) / this.countFloorCells(matrix);
      }
      if (dens < this.quality.fillTarget - 0.03) {
        this.rescueDeadVoids(
          arrows,
          occupancy,
          matrix,
          rng,
          DEFAULT_MAX_ARROW_LENGTH,
          DEFAULT_MAX_TAIL_LENGTH,
        );
      }
    }
    this.popUntilSolvable(arrows, occupancy, matrix);
    this.clampOpenings(arrows, occupancy, matrix, rng);
    this.rays = null;

    const occupiedCells = this.totalCells(arrows);
    const floorCells = this.countFloorCells(matrix);
    const solved = this.removalOrder(arrows, occupancy, matrix, rng);
    this.assignSolveIndices(arrows, solved ?? undefined);

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
   * Pink hole-packing: interlocking snakes that still obey cheap-exit, direction
   * quota, spoon, and macro-block rules. Aims for packTarget; fillWindingGaps
   * then pushes toward fillTarget with min-length winding snakes (no crumbs).
   */
  private packHoles(
    arrows: ArrowDefinition[],
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    rng: SeededRandom,
    maxLen: number,
    maxTail: number,
    startIndex?: number,
  ): void {
    const floor = this.countFloorCells(matrix);
    if (floor === 0) return;
    this.zoneBanActive = false;
    this.bannedZone = null;
    this.bannedRemaining = 0;
    const restoreSpoon = this.spoonStrict;
    const restoreQuota = this.quotaActive;
    const restoreVein = this.enforceVein;
    // Vein is a core-pass rule; packing must be free to close leftover highways.
    this.enforceVein = false;
    const packGoal = Math.ceil(floor * this.quality.packTarget);

    for (const block of this.macroBlocks) {
      block.radius = Math.min(this.macroRadiusCap, Math.max(block.radius, Math.floor(this.macroRadiusCap * 0.7)));
    }

    let nextIndex = startIndex ?? arrows.length;
    let longFails = 0;
    let relaxed = false;
    const failBudget = Math.max(
      28,
      Math.min(
        Math.floor(120 * this.quality.packFailBudgetScale),
        Math.floor((floor / 16) * this.quality.packFailBudgetScale),
      ),
    );

    while (this.totalCells(arrows) < packGoal) {
      const density = this.totalCells(arrows) / floor;
      if (!relaxed && longFails >= failBudget) {
        relaxed = true;
        longFails = 0;
      }
      // Pink keeps spoon + quota until the very last stretch so it cannot
      // dump a rim of same-direction free clicks.
      this.spoonStrict = !(relaxed && density >= this.quality.packTarget - 0.02);
      this.quotaActive = !(relaxed && density >= this.quality.packTarget - 0.02);
      const closing = density >= this.quality.packTarget - 0.04;
      const useBlock =
        !relaxed && this.quality.packFailBudgetScale >= 0.65
          ? this.pickFillerBlockId(occupancy, matrix, rng)
          : undefined;

      const snakeMax = relaxed
        ? rng.nextInt(FILLER_RELAX_MIN, FILLER_LONG_MAX)
        : rng.nextInt(FILLER_LONG_MIN, FILLER_LONG_MAX);
      const minLen = relaxed ? FILLER_RELAX_MIN : Math.min(FILLER_LONG_MIN, snakeMax);
      const candidate = this.tryPlaceSnake(
        occupancy,
        matrix,
        arrows,
        nextIndex,
        Math.min(snakeMax, this.snakeReachCap(occupancy, Math.max(maxLen, 12))),
        minLen,
        rng,
        {
          requireBlock: !relaxed && this.quality.packFailBudgetScale >= 0.65,
          frontierOnly: !relaxed && !closing,
          allowCheap: relaxed,
          allowLive: false,
          hunt: !relaxed && !closing && this.quality.packFailBudgetScale >= 0.65,
          preferPerp: true,
          blockId: useBlock,
          avoidSelfHug: true,
        },
      );
      if (!candidate) {
        longFails++;
        if (relaxed && longFails >= failBudget) break;
        continue;
      }
      const head = candidate.cells[candidate.cells.length - 1];
      const lane = this.laneLength(
        occupancy,
        matrix,
        head.row,
        head.col,
        DIRECTION_DELTA[candidate.direction],
      );
      if (candidate.cells.length <= 4 && this.isCheapExit(lane)) {
        longFails++;
        if (relaxed && longFails >= failBudget) break;
        continue;
      }
      const placed = {
        ...candidate,
        role: 'filler' as const,
        blockId:
          candidate.blockId ??
          useBlock ??
          this.cellMacroBlockId(head),
      };
      if (!this.tryCommit(arrows, occupancy, matrix, placed)) {
        longFails++;
        if (relaxed && longFails >= failBudget) break;
        continue;
      }
      nextIndex++;
      longFails = 0;
    }

    this.growTails(arrows, occupancy, matrix, Math.max(maxTail, this.snakeReachCap(occupancy, maxLen)), rng, false);
    this.rebuildAllRays(arrows, occupancy, matrix);
    this.spoonStrict = restoreSpoon;
    this.quotaActive = restoreQuota;
    this.enforceVein = restoreVein;
  }

  /**
   * Final mop-up without crumbs: place winding snakes (≥ FILLER_RELAX_MIN) until
   * fillTarget. Vein/spoon/quota off so leftover highways can still close.
   */
  private fillWindingGaps(
    arrows: ArrowDefinition[],
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    rng: SeededRandom,
    maxTail: number,
    startIndex = 0,
  ): void {
    const floor = this.countFloorCells(matrix);
    if (floor === 0) return;
    const restoreSpoon = this.spoonStrict;
    const restoreQuota = this.quotaActive;
    const restoreVein = this.enforceVein;
    this.spoonStrict = false;
    this.quotaActive = false;
    this.enforceVein = false;

    let nextIndex = startIndex;
    let fails = 0;
    const failBudget = Math.max(
      120,
      Math.min(360, Math.floor((floor / 4) * Math.max(1, this.quality.packFailBudgetScale))),
    );
    const fillGoal = Math.ceil(floor * this.quality.fillTarget);
    const reach = this.snakeReachCap(occupancy, Math.max(maxTail, POCKET_SNAKE_MAX));

    while (this.totalCells(arrows) < fillGoal && fails < failBudget) {
      if (floor - this.totalCells(arrows) < FILLER_RELAX_MIN) break;

      const loose = fails > failBudget * 0.12;
      const snakeMax = rng.nextInt(FILLER_RELAX_MIN, Math.min(FILLER_LONG_MAX + 8, reach));
      let candidate = this.tryPlaceSnake(
        occupancy,
        matrix,
        arrows,
        nextIndex,
        snakeMax,
        FILLER_RELAX_MIN,
        rng,
        {
          // Prefer free placement for mop-up; only the first few tries nest on rays.
          requireBlock: fails < 8 && !loose,
          frontierOnly: false,
          allowCheap: true,
          allowLive: false,
          hunt: true,
          preferPerp: true,
          avoidSelfHug: true,
        },
      );

      if (!candidate || candidate.cells.length < FILLER_RELAX_MIN) {
        const regions = this.emptyRegions(occupancy, matrix)
          .filter((region) => region.length >= FILLER_RELAX_MIN)
          .sort((a, b) => b.length - a.length);
        for (const region of regions.slice(0, 10)) {
          const pocket = new Set(region.map((cell) => this.key(cell)));
          const grown = this.tryPlacePocketSnake(
            occupancy,
            matrix,
            pocket,
            null,
            nextIndex,
            Math.min(POCKET_SNAKE_MAX, region.length),
            FILLER_RELAX_MIN,
            false,
            new Set(),
            rng,
            arrows,
            true,
          );
          if (grown && grown.cells.length >= FILLER_RELAX_MIN) {
            candidate = grown;
            break;
          }
        }
      }

      if (!candidate || candidate.cells.length < FILLER_RELAX_MIN) {
        fails++;
        continue;
      }

      const placed = {
        ...candidate,
        role: 'filler' as const,
        blockId:
          candidate.blockId ??
          this.cellMacroBlockId(candidate.cells[candidate.cells.length - 1]),
      };
      if (!this.tryCommit(arrows, occupancy, matrix, placed)) {
        fails++;
        continue;
      }
      nextIndex++;
      fails = Math.max(0, fails - 2);
    }

    this.growTails(arrows, occupancy, matrix, Math.max(maxTail, this.snakeReachCap(occupancy, 16)), rng, false);
    this.rebuildAllRays(arrows, occupancy, matrix);
    this.spoonStrict = restoreSpoon;
    this.quotaActive = restoreQuota;
    this.enforceVein = restoreVein;
  }

  /**
   * Some leftover voids (≥5) admit no solvable plug — every candidate deadlocks
   * the board. Peel nearby pink fillers that touch those voids, then re-pack.
   */
  private rescueDeadVoids(
    arrows: ArrowDefinition[],
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    rng: SeededRandom,
    maxLen: number,
    maxTail: number,
  ): void {
    const floor = this.countFloorCells(matrix);
    if (floor === 0) return;
    const fillGoal = Math.ceil(floor * this.quality.fillTarget);
    let rounds = 0;
    const maxRounds = this.quality.extraPackPasses ? 3 : 2;
    while (this.totalCells(arrows) < fillGoal && rounds < maxRounds) {
      rounds++;
      const dead = this.emptyRegions(occupancy, matrix)
        .filter((region) => region.length >= FILLER_RELAX_MIN)
        .sort((a, b) => b.length - a.length);
      if (dead.length === 0) break;

      const touch = new Set<string>();
      for (const region of dead.slice(0, 2)) {
        for (const cell of region) {
          touch.add(this.key(cell));
          for (const step of [
            { row: 1, col: 0 },
            { row: -1, col: 0 },
            { row: 0, col: 1 },
            { row: 0, col: -1 },
          ]) {
            touch.add(this.key({ row: cell.row + step.row, col: cell.col + step.col }));
          }
        }
      }

      const victims: number[] = [];
      for (let i = arrows.length - 1; i >= 0; i--) {
        const arrow = arrows[i];
        if (arrow.role !== 'filler' && arrow.role !== 'crumb') continue;
        if (!arrow.cells.some((cell) => touch.has(this.key(cell)))) continue;
        victims.push(i);
        if (victims.length >= 4) break;
      }
      if (victims.length === 0) break;

      for (const index of victims) {
        const [removed] = arrows.splice(index, 1);
        this.uncommitCells(occupancy, removed.cells);
        this.recordDirectionQuota(removed, occupancy, -1);
      }
      this.rebuildAllRays(arrows, occupancy, matrix);
      // Re-nest onto openings before free packing so rescue cannot leave 3+ lives.
      this.clampOpenings(arrows, occupancy, matrix, rng);

      const before = this.totalCells(arrows);
      this.fillEmptyRegions(
        arrows,
        occupancy,
        matrix,
        rng,
        maxTail,
        arrows.length + 72_000 + rounds * 1_000,
        maxLen,
      );
      this.fillWindingGaps(
        arrows,
        occupancy,
        matrix,
        rng,
        maxTail,
        arrows.length + 74_000 + rounds * 1_000,
      );
      if (this.totalCells(arrows) <= before) break;
    }
  }

  /** Prefer nesting onto live rays until ≤ MAX_OPENING_MOVES free clicks. */
  private clampOpenings(
    arrows: ArrowDefinition[],
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    rng?: SeededRandom,
  ): void {
    this.rebuildAllRays(arrows, occupancy, matrix);
    let guard = 0;
    const dice = rng ?? new SeededRandom(arrows.length * 1_000_003 + 17);
    while (this.countLiveArrows(arrows, occupancy, matrix) > MAX_OPENING_MOVES && guard++ < 16) {
      const before = this.countLiveArrows(arrows, occupancy, matrix);
      const candidate = this.tryPlaceSnake(
        occupancy,
        matrix,
        arrows,
        arrows.length + 60_000 + guard,
        Math.min(FILLER_LONG_MAX + 4, this.snakeReachCap(occupancy, 20)),
        FILLER_RELAX_MIN,
        dice,
        {
          requireBlock: true,
          frontierOnly: false,
          allowCheap: true,
          allowLive: false,
          hunt: true,
          preferPerp: true,
          avoidSelfHug: true,
        },
      );
      if (candidate && candidate.cells.length >= FILLER_RELAX_MIN) {
        const placed = {
          ...candidate,
          role: 'filler' as const,
          blockId:
            candidate.blockId ??
            this.cellMacroBlockId(candidate.cells[candidate.cells.length - 1]),
        };
        if (
          this.tryCommit(arrows, occupancy, matrix, placed) &&
          this.countLiveArrows(arrows, occupancy, matrix) < before
        ) {
          continue;
        }
      }
      break;
    }
  }

  /** Prefer a block that still has empty floor near its origin. */
  private pickFillerBlockId(
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    rng: SeededRandom,
  ): number | undefined {
    if (this.macroBlocks.length === 0) return undefined;
    const scored = this.macroBlocks.map((block) => {
      let empty = 0;
      const r = Math.max(4, block.radius);
      for (let row = Math.max(0, block.row - r); row <= Math.min(occupancy.rows - 1, block.row + r); row++) {
        for (let col = Math.max(0, block.col - r); col <= Math.min(occupancy.cols - 1, block.col + r); col++) {
          if (matrix[row][col] !== CELL_FLOOR) continue;
          if (occupancy.cells[row][col] !== null) continue;
          if (Math.abs(row - block.row) + Math.abs(col - block.col) > r) continue;
          empty++;
        }
      }
      return { id: block.id, empty };
    });
    scored.sort((a, b) => b.empty - a.empty || a.id - b.id);
    const nonempty = scored.filter((item) => item.empty > 0);
    if (nonempty.length === 0) return rng.pick(this.macroBlocks).id;
    return nonempty[0].empty === nonempty[Math.min(2, nonempty.length - 1)].empty
      ? rng.pick(nonempty.slice(0, Math.min(3, nonempty.length))).id
      : nonempty[0].id;
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
    const restoreSpoon = this.spoonStrict;
    const restoreQuota = this.quotaActive;
    const restoreVein = this.enforceVein;
    // Pocket mop-up must be free to close leftover voids; spoon/quota already
    // shaped the core + pink pack. Keeping them on here left ≥5-cell holes.
    this.spoonStrict = false;
    this.quotaActive = false;
    this.enforceVein = false;
    let fillerIndex = startFiller;
    const floor = this.countFloorCells(matrix);
    const density = floor === 0 ? 1 : this.totalCells(arrows) / floor;
    // Strip only when already very dense so early pocket pack can still
    // swallow voids; late boards keep live corridors for the opening moves.
    const liveRays =
      density >= this.quality.fillTarget - 0.01 ? this.liveRayCells() : new Set<string>();
    const regions = this.emptyRegions(occupancy, matrix);
    const regionCap =
      this.quality.packFailBudgetScale < 0.65
        ? Math.min(regions.length, 28)
        : regions.length;
    for (const region of regions.slice(0, regionCap)) {
      const parts = liveRays.size > 0 ? this.offRayGroups(region, liveRays) : [region];
      for (const part of parts) {
        if (part.length < 2) continue;
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
    this.growTails(arrows, occupancy, matrix, Math.max(maxTail, this.snakeReachCap(occupancy, maxLen)), rng, false);
    this.rebuildAllRays(arrows, occupancy, matrix);
    this.spoonStrict = restoreSpoon;
    this.quotaActive = restoreQuota;
    this.enforceVein = restoreVein;
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
      Math.floor(FILLER_QUICK_ATTEMPTS * this.quality.packFailBudgetScale),
      Math.min(
        Math.floor(24 * this.quality.packFailBudgetScale),
        Math.floor(region.length / 2),
      ),
    );

    while (this.emptyInPocket(occupancy, pocket) >= 2) {
      const remaining = this.emptyInPocket(occupancy, pocket);

      if (!relaxed && fails >= failLimit) {
        relaxed = true;
        fails = 0;
      }

      const requireBlock = !relaxed && last !== null;
      // Swallow the pocket when what's left fits one winding snake.
      if (remaining < FILLER_RELAX_MIN) break;
      const floorLen = relaxed ? FILLER_RELAX_MIN : Math.min(longMin, remaining);
      const candidate = this.tryPlacePocketSnake(
        occupancy,
        matrix,
        pocket,
        last,
        fillerIndex + placed,
        snakeCap,
        Math.min(floorLen, remaining),
        requireBlock,
        banned,
        rng,
        arrows,
        relaxed,
      );
      if (!candidate) {
        fails++;
        if (relaxed && fails >= failLimit) break;
        continue;
      }

      const head = candidate.cells[candidate.cells.length - 1];
      const lane = this.laneLength(
        occupancy,
        matrix,
        head.row,
        head.col,
        DIRECTION_DELTA[candidate.direction],
      );
      if (!relaxed && candidate.cells.length <= 4 && this.isCheapExit(lane)) {
        banned.add(`${head.row},${head.col}:${candidate.direction}`);
        fails++;
        continue;
      }
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
    allowCheap: boolean,
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
        allowCheap,
      );
      for (const direction of dirs) {
        if (banned.has(`${head.row},${head.col}:${direction}`)) continue;
        if (!this.escapesOnceOccupantsLeave(occupancy, matrix, head, direction)) {
          continue;
        }
        const delta = DIRECTION_DELTA[direction];
        const lane = this.laneLength(occupancy, matrix, head.row, head.col, delta);
        if (!allowCheap && this.isCheapExit(lane)) continue;
        const liveNow = lane >= 0;
        if (liveNow && this.countLiveArrows(placedArrows, occupancy, matrix) >= MAX_OPENING_MOVES) {
          continue;
        }

        const snakeMax = Math.max(minLen, this.rollSnakeMax(rng, maxLen, last === null, true));
        const need = minLen;
        const grown =
          this.growSnake(
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
            undefined,
            true,
          ) ??
          this.growSimplePocketPath(
            head,
            direction,
            occupancy,
            matrix,
            pocket,
            snakeMax,
            need,
            rng,
          );
        if (!grown) continue;
        if (this.violatesVeinRule(occupancy, matrix, grown)) continue;

        const blocks = focusRay.has(this.key(head)) || this.bodyHits(grown, focusRay, head);
        if (requireBlock && focusRay.size > 0 && !blocks) continue;

        return {
          id: `filler-${fillerIndex}-${head.row}x${head.col}`,
          cells: grown,
          direction,
          blockId: this.cellMacroBlockId(head),
          role: 'filler',
        };
      }
    }

    return null;
  }

  /**
   * Fallback for awkward leftover voids: grow a simple ortho path inside the
   * pocket without meander/hunt scoring (those often stall in thin corridors).
   * Returns tail→head cells, same as growSnake.
   */
  private growSimplePocketPath(
    head: GridCell,
    direction: Direction,
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    pocket: Set<string>,
    maxLen: number,
    minLen: number,
    rng: SeededRandom,
  ): GridCell[] | null {
    const forward = DIRECTION_DELTA[direction];
    const back: GridCell = { row: -forward.row, col: -forward.col };
    const neck = { row: head.row + back.row, col: head.col + back.col };
    const neckKey = this.key(neck);
    if (!pocket.has(neckKey)) return null;
    if (!this.isInside(occupancy, neck.row, neck.col)) return null;
    if (matrix[neck.row][neck.col] !== CELL_FLOOR) return null;
    if (occupancy.cells[neck.row][neck.col] !== null) return null;

    const path: GridCell[] = [{ ...head }, { ...neck }];
    const used = new Set<string>([this.key(head), neckKey]);
    let cur = neck;
    let heading = back;

    while (path.length < maxLen) {
      const options: GridCell[] = [];
      for (const step of [
        heading,
        { row: -heading.col, col: heading.row },
        { row: heading.col, col: -heading.row },
      ]) {
        const next = { row: cur.row + step.row, col: cur.col + step.col };
        const key = this.key(next);
        if (!pocket.has(key) || used.has(key)) continue;
        if (!this.isInside(occupancy, next.row, next.col)) continue;
        if (matrix[next.row][next.col] !== CELL_FLOOR) continue;
        if (occupancy.cells[next.row][next.col] !== null) continue;
        if (this.stepWouldSelfHug(path, next)) continue;
        options.push(next);
      }
      if (options.length === 0) break;
      const pick =
        options.find(
          (cell) => cell.row === cur.row + heading.row && cell.col === cur.col + heading.col,
        ) ?? rng.pick(options);
      heading = { row: pick.row - cur.row, col: pick.col - cur.col };
      path.push(pick);
      used.add(this.key(pick));
      cur = pick;
    }

    if (path.length < minLen) return null;
    return path.map((cell) => ({ ...cell })).reverse();
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
    allowCheap: boolean,
  ): Direction[] {
    const scored = ALL_DIRECTIONS.map((direction) => {
      const inner = this.pocketLane(head, direction, occupancy, pocket);
      const toLid = this.stepsToOccupant(head, direction, occupancy, matrix);
      const lane = this.laneLength(occupancy, matrix, head.row, head.col, DIRECTION_DELTA[direction]);
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
      if (this.quotaActive && this.directionQuotaBanned(this.zoneIndex(head, occupancy), direction)) {
        score -= 120;
      }
      if (!allowCheap && this.isCheapExit(lane)) score -= 90;
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

  /**
   * True when any empty floor patch is too small to host a winding snake
   * (1 … minViable−1 cells). Used by the vein rule after a trial placement.
   */
  private hasMicroEmptyRegions(
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    minViable: number,
  ): boolean {
    const seen: boolean[][] = Array.from({ length: occupancy.rows }, () =>
      Array<boolean>(occupancy.cols).fill(false),
    );

    for (let row = 0; row < occupancy.rows; row++) {
      for (let col = 0; col < occupancy.cols; col++) {
        if (seen[row][col]) continue;
        if (matrix[row][col] !== CELL_FLOOR) continue;
        if (occupancy.cells[row][col] !== null) continue;

        let size = 0;
        const stack: GridCell[] = [{ row, col }];
        seen[row][col] = true;

        while (stack.length > 0) {
          const cell = stack.pop()!;
          size++;
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

        if (size > 0 && size < minViable) return true;
      }
    }

    return false;
  }

  /**
   * Trial-commit cells, reject if they carve pockets too small for a winding
   * snake (1 … FILLER_RELAX_MIN−1). Leftovers of FILLER_RELAX_MIN+ stay fillable.
   * Only enforced once the board is dense.
   */
  private violatesVeinRule(
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    cells: GridCell[],
  ): boolean {
    if (!this.enforceVein) return false;
    if (this.occupancyDensity(occupancy, matrix) < ENDGAME_DENSITY) return false;
    const probe = '__vein__';
    for (const cell of cells) occupancy.cells[cell.row][cell.col] = probe;
    const bad = this.hasMicroEmptyRegions(occupancy, matrix, FILLER_RELAX_MIN);
    this.uncommitCells(occupancy, cells);
    return bad;
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
    requireSolvable = true,
  ): boolean {
    if (arrow.role === undefined && this.activeBlockId !== null) {
      arrow.blockId = this.activeBlockId;
    } else if (arrow.blockId === undefined) {
      const head = arrow.cells[arrow.cells.length - 1];
      arrow.blockId = this.cellMacroBlockId(head);
    }
    if (this.blocksAndWaitsForSame(arrow, occupancy, matrix)) return false;
    this.commitArrow(occupancy, arrow);
    arrows.push(arrow);
    this.noteOccupied(arrows, occupancy, matrix, arrow);
    if (requireSolvable && !this.removalOrder(arrows, occupancy, matrix)) {
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

  private tryPlaceSnake(
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    placed: ArrowDefinition[],
    arrowIndex: number,
    maxLen: number,
    minLen: number,
    rng: SeededRandom,
    opts: {
      requireBlock: boolean;
      frontierOnly: boolean;
      allowCheap?: boolean;
      allowLive?: boolean;
      hunt?: boolean;
      preferPerp?: boolean;
      blockId?: number;
      bridgeRay?: Set<string>;
      /** Pink / mop-up: never hug own body (fake self-blocks). */
      avoidSelfHug?: boolean;
    },
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

    if (!opts.blockId && !opts.bridgeRay && placed.length > 0 && liveCount < MAX_OPENING_MOVES && rng.next() < 0.7) {
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
    opts: {
      requireBlock: boolean;
      frontierOnly: boolean;
      allowCheap?: boolean;
      allowLive?: boolean;
      hunt?: boolean;
      preferPerp?: boolean;
      blockId?: number;
      bridgeRay?: Set<string>;
      avoidSelfHug?: boolean;
    },
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
      const bridgeFocus = opts.bridgeRay && opts.bridgeRay.size > 0 ? opts.bridgeRay : null;
      const focus =
        bridgeFocus ??
        (opts.blockId !== undefined
          ? this.pickNearHomeRay(placed, occupancy, matrix, rng, opts.blockId)
          : rayMode !== undefined
            ? this.pickFocusRay(
                placed,
                occupancy,
                matrix,
                rng,
                rayMode,
                opts.preferPerp === false ? undefined : direction,
              )
            : rayCells);
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
        ? this.sampleHuntHeads(occupancy, matrix, direction, focus, rng, maxLen, opts.blockId)
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
            ...this.orderHeads(hunters, rng, placed, occupancy, focus, maxLen, opts.blockId).slice(0, 12),
            ...this.orderHeads(onRay, rng, placed, occupancy, focus, maxLen, opts.blockId).slice(0, 16),
          ]
        : this.orderHeads(
            rng.shuffle([...hunters, ...onRay]),
            rng,
            placed,
            occupancy,
            focus,
            maxLen,
            opts.blockId,
          ).slice(0, 32);
      if (heads.length === 0) continue;
      const legal = this.filterHeadsByZone(heads, occupancy);
      const blockLegal =
        opts.blockId === undefined
          ? legal
          : legal.filter((head) => this.headBelongsToBlock(head.cell, opts.blockId));
      const quotaLegal = this.filterHeadsByQuota(legal, occupancy, direction);
      const banned = heads.filter((head) => this.zoneIsBanned(head.cell, occupancy));
      const blockBanned =
        opts.blockId === undefined
          ? banned
          : banned.filter((head) => this.headBelongsToBlock(head.cell, opts.blockId));
      const quotaBanned = this.filterHeadsByQuota(banned, occupancy, direction);
      batches.push({
        direction,
        legal:
          quotaLegal.length > 0
            ? blockLegal.filter((head) => quotaLegal.includes(head))
            : this.quotaActive
              ? quotaLegal
              : blockLegal,
        banned:
          quotaBanned.length > 0
            ? blockBanned.filter((head) => quotaBanned.includes(head))
            : this.quotaActive
              ? quotaBanned
              : blockBanned,
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
          ) === 0 &&
          !opts.allowCheap
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
          opts.blockId,
          opts.avoidSelfHug === true,
        );
        if (!cells) continue;
        if (this.violatesVeinRule(occupancy, matrix, cells)) continue;

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
          blockId: opts.blockId,
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
    homeBlockId?: number,
    avoidSelfHug = false,
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
    const boardDensity = this.occupancyDensity(occupancy, matrix);
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
      homeBlockId,
      boardDensity,
      avoidSelfHug,
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
      bridge: this.bridgeHuntActive,
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
      bridge: false,
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
    homeBlockId: number | undefined,
    boardDensity: number,
    avoidSelfHug = false,
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
        homeBlockId,
        boardDensity,
        avoidSelfHug,
      );
      if (homeBlockId !== undefined) {
        const allowCross = !this.lastBlockCrossedBorder || hunt.bridge;
        const slack = allowCross
          ? hunt.bridge && !hitPrimary
            ? FOREIGN_OVERLAP + 6
            : FOREIGN_OVERLAP + 2
          : 0;
        const homeOpts = options.filter((option) =>
          allowCross
            ? this.bodyStaysInBlock(option.cell, homeBlockId, slack)
            : this.cellMacroBlockId(option.cell) === homeBlockId ||
              this.headBelongsToBlock(option.cell, homeBlockId, HEAD_RADIUS_SLACK),
        );
        if (homeOpts.length > 0) options = homeOpts;
      }
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
    homeBlockId?: number,
    boardDensity = 0,
    avoidSelfHug = false,
  ): Array<{ cell: GridCell; turned: boolean; score: number }> {
    const endGameAmp = boardDensity > ENDGAME_DENSITY ? ENDGAME_MAGNET_AMP : 1;
    const leftH = { row: -heading.col, col: heading.row };
    const rightH = { row: heading.col, col: -heading.row };
    const raw: Array<{ cell: GridCell; turned: boolean; step: GridCell }> = [];

    const consider = (step: GridCell, turned: boolean): void => {
      const cell = { row: prev.row + step.row, col: prev.col + step.col };
      if (!this.canOccupy(occupancy, matrix, cell, path, head, direction, allowed)) return;
      raw.push({ cell, turned, step });
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
        const pull = hitPrimary
          ? MAGNET_AFTER_PRIMARY
          : MAGNET_PER_CELL * endGameAmp + (hunt.bridge ? BRIDGE_PULL : 0);
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
        score += PRIMARY_CROSS + (hunt.bridge ? BRIDGE_PULL : 0);
        if (hunt.focusAxis && stepAxis !== hunt.focusAxis) score += 45;
        else if (hunt.focusAxis && stepAxis === hunt.focusAxis) score -= 70;
      }
      if (onBonus) score += MULTI_RAY_CROSS * endGameAmp;

      if (homeBlockId !== undefined) {
        const home = this.macroBlocks.find((block) => block.id === homeBlockId);
        if (home) {
          const prevHome = Math.abs(prev.row - home.row) + Math.abs(prev.col - home.col);
          const nextHome = Math.abs(option.cell.row - home.row) + Math.abs(option.cell.col - home.col);
          if (this.cellMacroBlockId(option.cell) === homeBlockId) score += HOME_STAY;
          else score -= FOREIGN_STEP_PENALTY;
          if (hunt.bridge && nextHome < prevHome) score += 20;
        }
      }

      if (
        option.cell.row >= hunt.centerRow0 &&
        option.cell.row < hunt.centerRow1 &&
        option.cell.col >= hunt.centerCol0 &&
        option.cell.col < hunt.centerCol1
      ) {
        score += hitPrimary ? CENTER_BIAS : CENTER_BIAS * 2;
      }

      const coil = this.coilScore(occupancy, path, prev, option.cell);
      // Pink fillers must not coil against themselves (fake self-blocks).
      if (avoidSelfHug) {
        if (this.stepWouldSelfHug(path, option.cell)) score -= SELF_HUG_PENALTY;
        if (this.closesTwoByTwo(path, option.cell)) score -= 180;
      } else {
        score += hitPrimary ? coil : Math.round(coil * 0.15);
      }
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
    blockId?: number,
  ): HeadCandidate[] {
    const rayPts = this.cellsFromKeys(rayCells);
    if (rayPts.length === 0) return [];
    const delta = DIRECTION_DELTA[direction];
    const found: HeadCandidate[] = [];
    const seen = new Set<string>();
    const home = blockId === undefined ? null : this.macroBlocks.find((block) => block.id === blockId) ?? null;
    const radius = home
      ? Math.max(home.radius, 6)
      : Math.max(4, Math.floor(Math.max(occupancy.rows, occupancy.cols) * 0.28));
    const minGap = home ? 2 : HUNT_MIN_GAP;
    const maxGap = home
      ? Math.max(minGap + 1, home.radius + 8)
      : Math.max(HUNT_MIN_GAP + 1, maxLen - HUNT_BRANCH_RESERVE);
    for (let attempt = 0; attempt < 96 && found.length < 16; attempt++) {
      let row: number;
      let col: number;
      if (home && attempt < 80) {
        const span = radius + (attempt > 40 ? 4 : 0);
        row = Math.min(occupancy.rows - 1, Math.max(0, home.row + rng.nextInt(-span, span)));
        col = Math.min(occupancy.cols - 1, Math.max(0, home.col + rng.nextInt(-span, span)));
      } else {
        const sampled = attempt < 100 ? this.randomCellInUnbannedZone(rng, occupancy) : null;
        row = sampled ? sampled.row : rng.nextInt(0, occupancy.rows - 1);
        col = sampled ? sampled.col : rng.nextInt(0, occupancy.cols - 1);
      }
      const key = `${row},${col}`;
      if (seen.has(key) || rayCells.has(key)) continue;
      seen.add(key);
      if (matrix[row]?.[col] !== CELL_FLOOR || occupancy.cells[row][col] !== null) continue;
      const gap = this.nearestManhattanCells({ row, col }, rayPts);
      if (gap < minGap || gap > maxGap) continue;
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
    homeBlockId?: number,
  ): HeadCandidate[] {
    return this.orderHeadsUnfiltered(
      rng.shuffle(candidates),
      rng,
      placed,
      occupancy,
      rayCells,
      maxLen,
      homeBlockId,
    );
  }

  private orderHeadsUnfiltered(
    shuffled: HeadCandidate[],
    rng: SeededRandom,
    placed: ArrowDefinition[],
    occupancy: OccupancyGrid,
    rayCells: Set<string>,
    maxLen: number,
    homeBlockId?: number,
  ): HeadCandidate[] {
    const home = homeBlockId === undefined ? null : this.macroBlocks.find((block) => block.id === homeBlockId) ?? null;
    if (home) {
      const near = shuffled.filter((candidate) => this.headBelongsToBlock(candidate.cell, home.id));
      const pool = near.length > 0 ? near : shuffled.filter((candidate) =>
        this.headBelongsToBlock(candidate.cell, home.id, HEAD_RADIUS_SLACK + 4),
      );
      const ordered = (pool.length > 0 ? pool : shuffled).sort((a, b) => {
        const da = Math.abs(a.cell.row - home.row) + Math.abs(a.cell.col - home.col);
        const db = Math.abs(b.cell.row - home.row) + Math.abs(b.cell.col - home.col);
        return da - db;
      });
      return ordered;
    }
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
    respectBlocks = true,
  ): void {
    if (arrows.length === 0) return;
    const snapshot = arrows.map((arrow) => arrow.cells.map((cell) => ({ ...cell })));
    const before = this.totalCells(arrows);
    this.fillPass(arrows, occupancy, matrix, maxLength, respectBlocks);
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
    respectBlocks = true,
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
            respectBlocks,
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
    respectBlocks = true,
  ): ArrowDefinition | null {
    for (let index = arrows.length - 1; index > lastRayOwner; index--) {
      const arrow = arrows[index];
      const filler = arrow.role === 'filler' || arrow.role === 'crumb';
      const cap = filler ? Math.min(maxLength, FILLER_TAIL_CAP) : maxLength;
      if (arrow.cells.length >= cap) continue;
      const head = arrow.cells[arrow.cells.length - 1];
      if (this.isOnEscapeRay({ row, col }, head, arrow.direction)) continue;
      const tail = arrow.cells[0];
      if (Math.abs(tail.row - row) + Math.abs(tail.col - col) !== 1) continue;
      if (filler && this.stepWouldSelfHug(arrow.cells, { row, col })) continue;
      if (respectBlocks) {
        const cellBlock = this.cellMacroBlockId({ row, col });
        if (
          arrow.blockId !== undefined &&
          cellBlock !== undefined &&
          arrow.blockId !== cellBlock
        ) {
          const home = this.macroBlocks.find((block) => block.id === arrow.blockId);
          const other = this.macroBlocks.find((block) => block.id === cellBlock);
          if (home && other) {
            const homeDist = Math.abs(row - home.row) + Math.abs(col - home.col);
            const otherDist = Math.abs(row - other.row) + Math.abs(col - other.col);
            if (otherDist + FOREIGN_OVERLAP + 3 < homeDist) continue;
          }
        }
      }
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

  /**
   * True when `cell` would sit orthogonally against a non-consecutive cell of
   * `path` (U-hooks, spirals, fake self-blocks). The immediate predecessor is OK.
   */
  private stepWouldSelfHug(path: GridCell[], cell: GridCell): boolean {
    if (path.length === 0) return false;
    const prev = path[path.length - 1];
    for (const step of [
      { row: 1, col: 0 },
      { row: -1, col: 0 },
      { row: 0, col: 1 },
      { row: 0, col: -1 },
    ]) {
      const nr = cell.row + step.row;
      const nc = cell.col + step.col;
      if (prev.row === nr && prev.col === nc) continue;
      if (path.some((p) => p.row === nr && p.col === nc)) return true;
    }
    return false;
  }

  /** True when any non-consecutive cells of the polyline are orthogonally adjacent. */
  private pathSelfHugs(cells: GridCell[]): boolean {
    const index = new Map<string, number>();
    for (let i = 0; i < cells.length; i++) index.set(this.key(cells[i]), i);
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      for (const step of [
        { row: 1, col: 0 },
        { row: -1, col: 0 },
        { row: 0, col: 1 },
        { row: 0, col: -1 },
      ]) {
        const j = index.get(this.key({ row: cell.row + step.row, col: cell.col + step.col }));
        if (j === undefined) continue;
        if (Math.abs(i - j) > 1) return true;
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

  private occupancyDensity(occupancy: OccupancyGrid, matrix: CellValue[][]): number {
    const floor = this.countFloorCells(matrix);
    if (floor === 0) return 1;
    let occupied = 0;
    for (let row = 0; row < occupancy.rows; row++) {
      for (let col = 0; col < occupancy.cols; col++) {
        if (matrix[row][col] === CELL_FLOOR && occupancy.cells[row][col] !== null) occupied++;
      }
    }
    return occupied / floor;
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

  private setupMacroBlocks(occupancy: OccupancyGrid, matrix: CellValue[][], rng: SeededRandom): void {
    const floor = this.countFloorCells(matrix);
    if (floor <= 0) {
      this.macroBlocks = [];
      this.macroRobinIndex = 0;
      this.activeBlockId = null;
      this.lastVisitedBlockId = null;
      this.lastCommittedBlockId = null;
      this.clusterBudget = 0;
      this.clusterPlaced = 0;
      this.pendingBridgeRay = null;
      this.bridgeHuntActive = false;
      return;
    }
    const span = Math.max(occupancy.rows, occupancy.cols);
    this.macroRadiusCap = Math.max(10, Math.floor(span * 0.34));
    const target = rng.nextInt(2, 7);
    const blocks: MacroBlock[] = [];
    const minGap = Math.max(6, Math.floor(span * 0.22));
    const startRadius = Math.max(6, Math.floor(minGap * 0.5));
    let guard = 0;
    while (blocks.length < target && guard < 800) {
      guard++;
      const row = rng.nextInt(0, occupancy.rows - 1);
      const col = rng.nextInt(0, occupancy.cols - 1);
      if (matrix[row][col] !== CELL_FLOOR) continue;
      if (blocks.some((block) => Math.abs(block.row - row) + Math.abs(block.col - col) < minGap)) {
        continue;
      }
      blocks.push({ id: blocks.length, row, col, radius: startRadius });
    }
    if (blocks.length < 2) {
      const fallback = this.floorCells(matrix);
      for (const cell of fallback) {
        if (blocks.length >= 2) break;
        if (blocks.some((block) => Math.abs(block.row - cell.row) + Math.abs(block.col - cell.col) < minGap)) {
          continue;
        }
        blocks.push({ id: blocks.length, row: cell.row, col: cell.col, radius: startRadius });
      }
    }
    this.macroBlocks = rng.shuffle(blocks).map((block, index) => ({ ...block, id: index }));
    this.macroRobinIndex = 0;
    this.activeBlockId = this.macroBlocks[0]?.id ?? null;
    this.lastVisitedBlockId = null;
    this.lastCommittedBlockId = null;
    this.clusterBudget = this.macroBlocks.length > 0 ? rng.nextInt(1, 5) : 0;
    this.clusterPlaced = 0;
    this.pendingBridgeRay = null;
    this.bridgeHuntActive = false;
  }

  private floorCells(matrix: CellValue[][]): GridCell[] {
    const cells: GridCell[] = [];
    for (let row = 0; row < matrix.length; row++) {
      for (let col = 0; col < matrix[row].length; col++) {
        if (matrix[row][col] === CELL_FLOOR) cells.push({ row, col });
      }
    }
    return cells;
  }

  private cellMacroBlockId(cell: GridCell): number | undefined {
    if (this.macroBlocks.length === 0) return undefined;
    let best = this.macroBlocks[0];
    let bestDist = Number.POSITIVE_INFINITY;
    for (const block of this.macroBlocks) {
      const dist = Math.abs(block.row - cell.row) + Math.abs(block.col - cell.col);
      if (dist < bestDist) {
        bestDist = dist;
        best = block;
      }
    }
    return best.id;
  }

  private headBelongsToBlock(cell: GridCell, blockId: number | undefined, extra = HEAD_RADIUS_SLACK): boolean {
    if (blockId === undefined) return true;
    const home = this.macroBlocks.find((block) => block.id === blockId);
    if (!home) return true;
    return Math.abs(cell.row - home.row) + Math.abs(cell.col - home.col) <= home.radius + extra;
  }

  private bodyStaysInBlock(cell: GridCell, homeBlockId: number, slack: number): boolean {
    if (this.headBelongsToBlock(cell, homeBlockId, slack)) return true;
    const owner = this.cellMacroBlockId(cell);
    if (owner === homeBlockId) return true;
    const home = this.macroBlocks.find((block) => block.id === homeBlockId);
    const other = owner === undefined ? undefined : this.macroBlocks.find((block) => block.id === owner);
    if (!home || !other) return true;
    const homeDist = Math.abs(cell.row - home.row) + Math.abs(cell.col - home.col);
    const otherDist = Math.abs(cell.row - other.row) + Math.abs(cell.col - other.col);
    return homeDist <= otherDist + slack;
  }

  private expandActiveBlockRadius(): void {
    if (this.activeBlockId === null) return;
    const home = this.macroBlocks.find((block) => block.id === this.activeBlockId);
    if (!home) return;
    home.radius = Math.min(this.macroRadiusCap, home.radius + 2);
  }

  private pickNearHomeRay(
    placed: ArrowDefinition[],
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    rng: SeededRandom,
    homeBlockId: number,
  ): Set<string> {
    const home = this.macroBlocks.find((block) => block.id === homeBlockId);
    if (!home || placed.length === 0) {
      return this.pickFocusRay(placed, occupancy, matrix, rng, 'oldest');
    }
    const byId = new Map(placed.map((arrow) => [arrow.id, arrow]));
    const cache = this.rays;
    const ids = cache && cache.unblocked.length > 0 ? cache.unblocked : placed.map((arrow) => arrow.id);
    const preferForeign = rng.next() < 0.6;
    let best: Set<string> | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const id of ids) {
      const arrow = byId.get(id);
      if (!arrow) continue;
      const ray = cache?.byId.get(id)?.cellSet ?? this.collectRay(arrow, occupancy, matrix);
      if (!ray || ray.size === 0) continue;
      let nearest = Number.POSITIVE_INFINITY;
      for (const key of ray) {
        const [row, col] = key.split(',').map(Number);
        const dist = Math.abs(row - home.row) + Math.abs(col - home.col);
        if (dist < nearest) nearest = dist;
      }
      if (!Number.isFinite(nearest)) continue;
      const foreign = arrow.blockId !== undefined && arrow.blockId !== homeBlockId;
      const score = nearest + (preferForeign && !foreign ? 8 : 0) + (foreign ? 0 : 3);
      if (score < bestScore) {
        bestScore = score;
        best = ray instanceof Set ? new Set(ray) : new Set(ray);
      }
    }
    return best && bestScore <= home.radius + 10
      ? best
      : this.pickFocusRay(placed, occupancy, matrix, rng, 'oldest');
  }

  private rollMacroCluster(
    rng: SeededRandom,
    arrows: ArrowDefinition[],
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    consecutiveFailures: number,
  ): boolean {
    if (this.macroBlocks.length < 2) {
      this.activeBlockId = null;
      this.lastVisitedBlockId = null;
      this.lastCommittedBlockId = null;
      this.pendingBridgeRay = null;
      this.bridgeHuntActive = false;
      return false;
    }
    if (consecutiveFailures >= 8) this.clusterPlaced = this.clusterBudget;
    if (this.clusterPlaced < this.clusterBudget) return false;

    this.lastVisitedBlockId = this.activeBlockId;
    const count = this.macroBlocks.length;
    for (let step = 0; step < count; step++) {
      this.macroRobinIndex = (this.macroRobinIndex + 1) % count;
      this.activeBlockId = this.macroBlocks[this.macroRobinIndex].id;
      if (this.activeBlockId !== this.lastCommittedBlockId || count < 3) break;
    }
    this.clusterBudget = rng.nextInt(1, 5);
    this.clusterPlaced = 0;
    this.lastBlockCrossedBorder = false;
    this.pendingBridgeRay =
      arrows.length === 0
        ? null
        : this.pickForeignBlockRay(arrows, occupancy, matrix, this.lastVisitedBlockId, this.activeBlockId);
    return true;
  }

  private pickForeignBlockRay(
    placed: ArrowDefinition[],
    occupancy: OccupancyGrid,
    matrix: CellValue[][],
    preferBlockId: number | null,
    excludeBlockId: number | null,
  ): Set<string> {
    const byId = new Map(placed.map((arrow) => [arrow.id, arrow]));
    const preferred: Set<string>[] = [];
    const foreign: Set<string>[] = [];
    const any: Set<string>[] = [];
    const cache = this.rays;
    const ids = cache && cache.unblocked.length > 0 ? cache.unblocked : placed.map((arrow) => arrow.id);
    for (const id of ids) {
      const arrow = byId.get(id);
      if (!arrow) continue;
      const ray = cache?.byId.get(id)?.cellSet ?? this.collectRay(arrow, occupancy, matrix);
      if (!ray || ray.size === 0) continue;
      const copy = ray instanceof Set ? new Set(ray) : ray;
      any.push(copy);
      if (excludeBlockId !== null && arrow.blockId === excludeBlockId) continue;
      foreign.push(copy);
      if (preferBlockId !== null && arrow.blockId === preferBlockId) preferred.push(copy);
    }
    const pool = preferred.length > 0 ? preferred : foreign.length > 0 ? foreign : any;
    const home = excludeBlockId === null ? null : this.macroBlocks.find((block) => block.id === excludeBlockId) ?? null;
    if (!home || pool.length === 0) return pool[0] ?? new Set();
    let best = pool[0];
    let bestDist = Number.POSITIVE_INFINITY;
    for (const ray of pool) {
      let nearest = Number.POSITIVE_INFINITY;
      for (const key of ray) {
        const [row, col] = key.split(',').map(Number);
        const dist = Math.abs(row - home.row) + Math.abs(col - home.col);
        if (dist < nearest) nearest = dist;
      }
      if (nearest < bestDist) {
        bestDist = nearest;
        best = ray;
      }
    }
    return best ?? new Set();
  }

  private noteMacroCommit(arrow: ArrowDefinition): void {
    if (this.macroBlocks.length < 2) return;
    const head = arrow.cells[arrow.cells.length - 1];
    arrow.blockId = this.activeBlockId ?? this.cellMacroBlockId(head);
    this.lastCommittedBlockId = arrow.blockId ?? null;
    this.clusterPlaced += 1;
    this.pendingBridgeRay = null;
    this.bridgeHuntActive = false;
    this.lastBlockCrossedBorder =
      arrow.blockId !== undefined && this.arrowCrossesBlockBorder(arrow, arrow.blockId);
  }

  private arrowCrossesBlockBorder(arrow: ArrowDefinition, homeBlockId: number): boolean {
    for (const cell of arrow.cells) {
      const owner = this.cellMacroBlockId(cell);
      if (owner !== undefined && owner !== homeBlockId) return true;
    }
    return false;
  }

  private assignSolveIndices(arrows: ArrowDefinition[], solved?: ArrowDefinition[]): void {
    if (arrows.length === 0) return;
    if (solved && solved.length === arrows.length) {
      const byId = new Map(arrows.map((arrow) => [arrow.id, arrow]));
      solved.forEach((arrow, index) => {
        const target = byId.get(arrow.id);
        if (target) target.solveIndex = index + 1;
      });
      return;
    }
    for (let index = 0; index < arrows.length; index++) {
      arrows[index].solveIndex = arrows.length - index;
    }
  }

  private inferDifficulty(occupiedCells: number, floorCells: number): Difficulty {
    const density = floorCells === 0 ? 0 : occupiedCells / floorCells;
    if (density < 0.18) return 'easy';
    if (density < 0.32) return 'medium';
    return 'hard';
  }
}

function qualityKnobs(quality: GenerationQuality): QualityKnobs {
  if (quality === 'fast') {
    return {
      coreTarget: 0.84,
      packTarget: 0.91,
      fillTarget: 0.93,
      maxCrumbShare: 0,
      maxAttemptsCap: 400,
      saturationRetries: 56,
      packFailBudgetScale: 0.85,
      extraPackPasses: false,
    };
  }
  if (quality === 'quality') {
    return {
      coreTarget: 0.88,
      packTarget: 0.94,
      fillTarget: 0.96,
      maxCrumbShare: 0,
      maxAttemptsCap: 900,
      saturationRetries: 100,
      packFailBudgetScale: 1.25,
      extraPackPasses: true,
    };
  }
  return {
    coreTarget: 0.86,
    packTarget: 0.93,
    fillTarget: 0.95,
    maxCrumbShare: 0,
    maxAttemptsCap: 560,
    saturationRetries: 64,
    packFailBudgetScale: 1.0,
    extraPackPasses: true,
  };
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
  extras?: Pick<SLevelGeneratorOptions, 'forceRandomize' | 'randomSalt' | 'quality'>,
): Level {
  return new SLevelGenerator().generate({ sLevelIndex, seed, quality: 'quality', ...extras });
}

/** Pack leftover floor on an existing board using the generator's fill passes. */
export function fillLevelVacancies(level: Level, seed?: number): Level {
  return new SLevelGenerator().fillVacancies(level, seed);
}
