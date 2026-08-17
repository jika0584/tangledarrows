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

export interface TapResolution {
  result: SlideResult;
  nextState: BoardState;
}

/**
 * Applies a tap on an arrow head and returns the resulting board state.
 * Pure — the caller drives animation from `result`, then commits `nextState`.
 */
export function applyTap(state: BoardState, arrowId: string): TapResolution | null {
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

  // Blocked: the arrow recoils to its original cells and costs a life.
  const lives = state.lives - 1;
  return {
    result,
    nextState: {
      ...state,
      lives,
      moves: state.moves + 1,
      status: lives <= 0 ? 'lost' : 'playing',
    },
  };
}

export function isSolved(state: BoardState): boolean {
  return state.arrows.length === 0;
}
