import { ArrowDefinition, Level, MAX_LIVES } from '../../levels/types';
import { OccupancyIndex } from './Grid';
import { SlideResult, resolveSlide } from './Collision';

export interface BoardState {
  level: Level;
  /** Arrows still on the board, in render order. */
  arrows: ArrowDefinition[];
  lives: number;
  moves: number;
  status: 'playing' | 'won' | 'lost';
}

export function createBoardState(level: Level): BoardState {
  return {
    level,
    arrows: level.arrows.map((arrow) => ({ ...arrow, cells: [...arrow.cells] })),
    lives: MAX_LIVES,
    moves: 0,
    status: 'playing',
  };
}

/** Rebuilds a mid-run board from a saved snapshot of remaining pieces. */
export function restoreBoardState(
  level: Level,
  remainingArrowIds: readonly string[],
  lives: number,
  moves: number,
): BoardState {
  const keep = new Set(remainingArrowIds);
  const arrows = level.arrows
    .filter((arrow) => keep.has(arrow.id))
    .map((arrow) => ({ ...arrow, cells: [...arrow.cells] }));

  return {
    level,
    arrows,
    lives: Math.max(0, Math.min(MAX_LIVES, lives)),
    moves: Math.max(0, moves),
    status: arrows.length === 0 ? 'won' : 'playing',
  };
}

export interface TapResolution {
  result: SlideResult;
  nextState: BoardState;
}

export interface TapOptions {
  /** When false, a blocked tap recoils but never spends a life. Defaults on for tests. */
  heartsEnabled?: boolean;
}

/**
 * Applies a tap on an arrow head and returns the resulting board state.
 * Pure — the caller drives animation from `result`, then commits `nextState`.
 */
export function applyTap(
  state: BoardState,
  arrowId: string,
  options?: TapOptions,
): TapResolution | null {
  if (state.status !== 'playing') return null;

  const arrow = state.arrows.find((a) => a.id === arrowId);
  if (!arrow) return null;

  const occupancy = new OccupancyIndex(state.arrows);
  const result = resolveSlide(arrow, state.level.grid, occupancy);

  if (result.outcome === 'escaped') {
    const arrows = state.arrows.filter((a) => a.id !== arrowId);
    return {
      result,
      nextState: {
        ...state,
        arrows,
        moves: state.moves + 1,
        status: arrows.length === 0 ? 'won' : 'playing',
      },
    };
  }

  const heartsEnabled = options?.heartsEnabled ?? true;
  if (!heartsEnabled) {
    return {
      result,
      nextState: {
        ...state,
        moves: state.moves + 1,
        status: 'playing',
      },
    };
  }

  // Blocked: the arrow recoils and costs a heart, until none are left.
  const lives = Math.max(0, state.lives - 1);
  return {
    result,
    nextState: {
      ...state,
      lives,
      moves: state.moves + 1,
      // Only the last heart trips the overlay. After Continue, lives stay at 0
      // and missed taps just recoil.
      status: state.lives > 0 && lives <= 0 ? 'lost' : 'playing',
    },
  };
}

/** Dismisses the out-of-hearts overlay and lets the current board keep going. */
export function continueAfterLoss(state: BoardState): BoardState {
  if (state.status !== 'lost') return state;
  return { ...state, status: 'playing' };
}

export function isSolved(state: BoardState): boolean {
  return state.arrows.length === 0;
}
