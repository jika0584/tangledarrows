import { useCallback, useEffect, useRef, useState } from 'react';
import { Level } from '../../levels/types';
import { BoardState, applyTap, createBoardState } from '../engine/Movement';
import { ArrowAnimation } from '../../components/ArrowShape';

export interface UseBoardResult {
  state: BoardState;
  animations: Record<string, ArrowAnimation>;
  tapArrow: (arrowId: string) => void;
  onArrowAnimationEnd: (arrowId: string) => void;
  restart: () => void;
}

/**
 * Bridges pure engine state to the animated view.
 *
 * A tap resolves collision immediately so the slide starts on the same frame.
 * An escaping arrow is only removed from the board once its animation ends,
 * which keeps it a valid blocker for anything tapped while it is mid-flight.
 */
export function useBoard(level: Level): UseBoardResult {
  const [state, setState] = useState<BoardState>(() => createBoardState(level));
  const [animations, setAnimations] = useState<Record<string, ArrowAnimation>>({});

  // Mirrors state for synchronous reads inside gesture callbacks.
  const stateRef = useRef(state);
  stateRef.current = state;

  // Arrows currently sliding off the board, awaiting removal.
  const escaping = useRef(new Set<string>());
  const tokenRef = useRef(0);
  const loadedLevelId = useRef(level.id);

  useEffect(() => {
    // Skip the initial run; useState already seeded the first level.
    if (loadedLevelId.current === level.id) return;
    loadedLevelId.current = level.id;
    escaping.current.clear();
    setAnimations({});
    setState(createBoardState(level));
  }, [level]);

  const tapArrow = useCallback((arrowId: string) => {
    if (escaping.current.has(arrowId)) return;

    const resolution = applyTap(stateRef.current, arrowId);
    if (!resolution) return;

    const { result, nextState } = resolution;
    const token = ++tokenRef.current;

    if (result.outcome === 'escaped') {
      escaping.current.add(arrowId);
      setAnimations((prev) => ({
        ...prev,
        [arrowId]: { kind: 'escape', distance: result.distance, token },
      }));
      return;
    }

    // Blocked: the life is spent immediately, the arrow recoils and stays put.
    setAnimations((prev) => ({
      ...prev,
      [arrowId]: { kind: 'recoil', distance: result.distance, token },
    }));
    setState(nextState);
  }, []);

  const onArrowAnimationEnd = useCallback((arrowId: string) => {
    setAnimations((prev) => {
      if (!prev[arrowId]) return prev;
      const { [arrowId]: _done, ...rest } = prev;
      return rest;
    });

    if (!escaping.current.delete(arrowId)) return;

    setState((current) => {
      const arrows = current.arrows.filter((a) => a.id !== arrowId);
      if (arrows.length === current.arrows.length) return current;
      return {
        ...current,
        arrows,
        moves: current.moves + 1,
        status: arrows.length === 0 ? 'won' : current.status,
      };
    });
  }, []);

  const restart = useCallback(() => {
    escaping.current.clear();
    setAnimations({});
    setState(createBoardState(level));
  }, [level]);

  return { state, animations, tapArrow, onArrowAnimationEnd, restart };
}
