import { useCallback, useEffect, useRef, useState } from 'react';
import { Level } from '../../../src/levels/types';
import { BoardState, applyTap, createBoardState } from '../../../src/game/engine/Movement';

export type PlayAnimation =
  | { kind: 'escape'; distance: number; token: number }
  | { kind: 'recoil'; distance: number; token: number };

export function usePlay(level: Level | null) {
  const [state, setState] = useState<BoardState | null>(
    level ? createBoardState(level) : null,
  );
  const [animations, setAnimations] = useState<Record<string, PlayAnimation>>({});
  const [failed, setFailed] = useState<ReadonlySet<string>>(EMPTY);
  const stateRef = useRef(state);
  stateRef.current = state;
  const escaping = useRef(new Set<string>());
  const tokenRef = useRef(0);
  const loadedId = useRef(level?.id ?? null);

  const [playingDemo, setPlayingDemo] = useState(false);
  const queueRef = useRef<string[]>([]);
  const demoActive = useRef(false);

  useEffect(() => {
    if ((level?.id ?? null) === loadedId.current) return;
    loadedId.current = level?.id ?? null;
    escaping.current.clear();
    demoActive.current = false;
    queueRef.current = [];
    setPlayingDemo(false);
    setAnimations({});
    setFailed(EMPTY);
    setState(level ? createBoardState(level) : null);
  }, [level]);

  const tapArrow = useCallback((arrowId: string, fromDemo = false) => {
    if (!stateRef.current || escaping.current.has(arrowId)) return;
    if (demoActive.current && !fromDemo) return;
    const resolution = applyTap(stateRef.current, arrowId);
    if (!resolution) return;
    const token = ++tokenRef.current;

    if (resolution.result.outcome === 'escaped') {
      escaping.current.add(arrowId);
      setFailed((prev) => without(prev, arrowId));
      setAnimations((prev) => ({
        ...prev,
        [arrowId]: { kind: 'escape', distance: resolution.result.distance, token },
      }));
      return;
    }

    setFailed((prev) => withId(prev, arrowId));
    setAnimations((prev) => ({
      ...prev,
      [arrowId]: { kind: 'recoil', distance: resolution.result.distance, token },
    }));
    setState(resolution.nextState);
  }, []);

  const onAnimationEnd = useCallback((arrowId: string) => {
    setAnimations((prev) => {
      if (!prev[arrowId]) return prev;
      const { [arrowId]: _done, ...rest } = prev;
      return rest;
    });
    if (!escaping.current.delete(arrowId)) return;
    setState((current) => {
      if (!current) return current;
      const arrows = current.arrows.filter((arrow) => arrow.id !== arrowId);
      if (arrows.length === current.arrows.length) return current;
      const next = {
        ...current,
        arrows,
        moves: current.moves + 1,
        status: arrows.length === 0 ? 'won' : current.status,
      } as typeof current;
      return next;
    });
    if (demoActive.current) {
      const nextId = queueRef.current.shift();
      if (!nextId) {
        demoActive.current = false;
        setPlayingDemo(false);
        return;
      }
      window.setTimeout(() => tapArrow(nextId, true), 220);
    }
  }, [tapArrow]);

  const restart = useCallback(() => {
    if (!level) return;
    escaping.current.clear();
    demoActive.current = false;
    queueRef.current = [];
    setPlayingDemo(false);
    setAnimations({});
    setFailed(EMPTY);
    setState(createBoardState(level));
  }, [level]);

  const playSolution = useCallback(
    (order: string[]) => {
      if (!level || order.length === 0) return;
      escaping.current.clear();
      setAnimations({});
      setFailed(EMPTY);
      setState(createBoardState(level));
      demoActive.current = true;
      setPlayingDemo(true);
      const [first, ...rest] = order;
      queueRef.current = rest;
      window.setTimeout(() => tapArrow(first, true), 80);
    },
    [level, tapArrow],
  );

  const stopSolution = useCallback(() => {
    demoActive.current = false;
    queueRef.current = [];
    setPlayingDemo(false);
  }, []);

  return { state, animations, failed, playingDemo, tapArrow, onAnimationEnd, restart, playSolution, stopSolution };
}

const EMPTY: ReadonlySet<string> = new Set();

function withId(ids: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (ids.has(id)) return ids;
  const next = new Set(ids);
  next.add(id);
  return next;
}

function without(ids: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (!ids.has(id)) return ids;
  const next = new Set(ids);
  next.delete(id);
  return next;
}
