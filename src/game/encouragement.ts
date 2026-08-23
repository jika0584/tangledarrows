import { BoardState } from './engine/Movement';
import { escapableArrowIds } from './engine/WinCondition';

export interface EscapeEvent {
  arrowId: string;
  combo: number;
  escapableCount: number;
  wasFailed: boolean;
  arrowsLeft: number;
  arrowTotal: number;
}

export function describeEscape(event: EscapeEvent): { emoji: string; message: string } | null {
  if (event.wasFailed) {
    return { emoji: '💡', message: 'Nice recovery!' };
  }
  if (event.escapableCount === 1 && event.arrowsLeft >= 4) {
    return { emoji: '🎯', message: 'Good find!' };
  }
  if (event.combo >= 5) {
    return { emoji: '🔥', message: 'Unstoppable!' };
  }
  if (event.combo >= 3) {
    return { emoji: '⚡', message: 'Great combo!' };
  }
  return null;
}

export function buildEscapeEvent(
  state: BoardState,
  arrowId: string,
  combo: number,
  wasFailed: boolean,
  arrowTotal: number,
): EscapeEvent {
  return {
    arrowId,
    combo,
    escapableCount: escapableArrowIds(state).length,
    wasFailed,
    arrowsLeft: state.arrows.length,
    arrowTotal,
  };
}

export const PROGRESS_TOASTS = [
  { ratio: 0.5, emoji: '🙂', message: 'Halfway there!' },
  { ratio: 1 / 3, emoji: '👏', message: 'Keep going!' },
  { ratio: 0.1, emoji: '⭐', message: 'Bravo! Almost there' },
] as const;
