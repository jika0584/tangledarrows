import { useCallback, useEffect, useRef, useState } from 'react';
import { Level } from '../../levels/types';
import { BoardState, applyTap, continueAfterLoss, createBoardState, restoreBoardState } from '../engine/Movement';
import { OccupancyIndex } from '../engine/Grid';
import { canEscape } from '../engine/Collision';
import { ArrowAnimation } from '../../components/ArrowShape';
import { buildEscapeEvent, EscapeEvent } from '../encouragement';
import { RunCache, isResumable } from '../../store/runCache';

export interface UseBoardResult {
  state: BoardState;
  animations: Record<string, ArrowAnimation>;
  /** Arrows the player has already tried that could not leave. */
  failedArrowIds: ReadonlySet<string>;
  /** Consecutive escapes within the live combo window. */
  combo: number;
  /** Each combo streak of 2+ recorded when the streak ends. */
  comboPayouts: readonly number[];
  /** Blocked taps this run. */
  mistakeCount: number;
  /** True once any blocked tap happened this run (resets on restart). */
  hadMistake: boolean;
  tapArrow: (arrowId: string) => void;
  onArrowAnimationEnd: (arrowId: string) => void;
  restart: () => void;
  continueAnyway: () => void;
}

/**
 * Bridges pure engine state to the animated view.
 *
 * Taps are queued while a slide or recoil is on screen, then resolved in order
 * against the board as it actually is once that animation finishes. Failed
 * (red) arrows that become free are inserted at the front of that queue.
 */
export function useBoard(
  level: Level,
  restored?: RunCache | null,
  options?: { heartsEnabled?: boolean; onEscape?: (event: EscapeEvent) => void },
): UseBoardResult {
  const heartsEnabled = options?.heartsEnabled ?? true;
  const heartsRef = useRef(heartsEnabled);
  heartsRef.current = heartsEnabled;
  const onEscapeRef = useRef(options?.onEscape);
  onEscapeRef.current = options?.onEscape;
  const arrowTotalRef = useRef(level.arrows.length);
  arrowTotalRef.current = level.arrows.length;

  const [state, setState] = useState<BoardState>(() => initialBoard(level, restored));
  const [animations, setAnimations] = useState<Record<string, ArrowAnimation>>({});
  const [failedArrowIds, setFailedArrowIds] = useState<ReadonlySet<string>>(
    () => initialFailed(restored),
  );
  const [combo, setCombo] = useState(0);
  const [comboPayouts, setComboPayouts] = useState<number[]>([]);
  const [mistakeCount, setMistakeCount] = useState(() => initialMistakeCount(restored));
  const [hadMistake, setHadMistake] = useState(() => initialHadMistake(restored));

  const stateRef = useRef(state);
  stateRef.current = state;
  const animationsRef = useRef(animations);
  animationsRef.current = animations;
  const failedRef = useRef(failedArrowIds);
  failedRef.current = failedArrowIds;
  const comboRef = useRef(0);
  const comboPayoutsRef = useRef<number[]>([]);
  const lastComboAtRef = useRef<number | null>(null);
  const comboTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const escaping = useRef(new Set<string>());
  const queueRef = useRef<string[]>([]);
  const tokenRef = useRef(0);
  const loadedLevelId = useRef(level.id);

  const busy = (): boolean =>
    escaping.current.size > 0 || Object.keys(animationsRef.current).length > 0;

  const clearCombo = (recordPayout = false): void => {
    if (recordPayout && comboRef.current >= 2) {
      comboPayoutsRef.current = [...comboPayoutsRef.current, comboRef.current];
      setComboPayouts(comboPayoutsRef.current);
    }
    if (comboTimeoutRef.current) clearTimeout(comboTimeoutRef.current);
    comboTimeoutRef.current = null;
    comboRef.current = 0;
    lastComboAtRef.current = null;
    setCombo(0);
  };

  const registerComboEscape = (): void => {
    const now = Date.now();
    const last = lastComboAtRef.current;
    if (last !== null && now - last > COMBO_WINDOW_MS) {
      comboRef.current = 0;
    }
    comboRef.current += 1;
    lastComboAtRef.current = now;
    setCombo(comboRef.current);

    if (comboTimeoutRef.current) clearTimeout(comboTimeoutRef.current);
    comboTimeoutRef.current = setTimeout(() => {
      clearCombo(true);
    }, COMBO_WINDOW_MS);
  };

  const enqueue = (arrowId: string): void => {
    if (escaping.current.has(arrowId)) return;
    if (queueRef.current.includes(arrowId)) return;
    queueRef.current.push(arrowId);
  };

  const beginAction = (arrowId: string): boolean => {
    if (escaping.current.has(arrowId)) return false;

    const resolution = applyTap(stateRef.current, arrowId, {
      heartsEnabled: heartsRef.current,
    });
    if (!resolution) return false;

    const { result, nextState } = resolution;
    const token = ++tokenRef.current;

    if (result.outcome === 'escaped') {
      escaping.current.add(arrowId);
      const wasFailed = failedRef.current.has(arrowId);
      registerComboEscape();
      setFailedArrowIds((prev) => withoutId(prev, arrowId));
      setAnimations((prev) => ({
        ...prev,
        [arrowId]: { kind: 'escape', distance: result.distance, token },
      }));
      onEscapeRef.current?.(
        buildEscapeEvent(
          stateRef.current,
          arrowId,
          comboRef.current,
          wasFailed,
          arrowTotalRef.current,
        ),
      );
      return true;
    }

    clearCombo(true);
    setMistakeCount((count) => count + 1);
    setHadMistake(true);
    setFailedArrowIds((prev) => withId(prev, arrowId));
    setAnimations((prev) => ({
      ...prev,
      [arrowId]: { kind: 'recoil', distance: result.distance, token },
    }));
    setState(nextState);
    return true;
  };

  const enqueueFreedFailed = (): void => {
    const current = stateRef.current;
    if (current.status !== 'playing') return;
    const occupancy = new OccupancyIndex(current.arrows);
    const freed: string[] = [];
    for (const id of failedRef.current) {
      if (escaping.current.has(id)) continue;
      const arrow = current.arrows.find((item) => item.id === id);
      if (!arrow) continue;
      if (canEscape(arrow, current.level.grid, occupancy)) freed.push(id);
    }
    if (freed.length === 0) return;
    const rest = queueRef.current.filter((id) => !freed.includes(id));
    queueRef.current = [...freed, ...rest];
  };

  const flushQueue = (): void => {
    if (busy()) return;
    const current = stateRef.current;
    if (current.status !== 'playing') {
      queueRef.current = [];
      return;
    }
    enqueueFreedFailed();
    while (queueRef.current.length > 0) {
      const next = queueRef.current.shift()!;
      if (beginAction(next)) return;
    }
  };

  useEffect(() => {
    if (loadedLevelId.current === level.id) return;
    loadedLevelId.current = level.id;
    escaping.current.clear();
    queueRef.current = [];
    clearCombo(false);
    comboPayoutsRef.current = [];
    setComboPayouts([]);
    setMistakeCount(initialMistakeCount(restored));
    setHadMistake(initialHadMistake(restored));
    setAnimations({});
    setFailedArrowIds(initialFailed(restored));
    setState(initialBoard(level, restored));
  }, [level, restored]);

  useEffect(() => {
    flushQueue();
  }, [animations, state.arrows, state.status, failedArrowIds]);

  useEffect(
    () => () => {
      if (comboTimeoutRef.current) clearTimeout(comboTimeoutRef.current);
    },
    [],
  );

  const tapArrow = useCallback((arrowId: string) => {
    if (stateRef.current.status !== 'playing') return;
    if (escaping.current.has(arrowId)) return;
    if (busy()) {
      enqueue(arrowId);
      return;
    }
    beginAction(arrowId);
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
      const won = arrows.length === 0;
      if (won) clearCombo(true);
      return {
        ...current,
        arrows,
        moves: current.moves + 1,
        status: won ? 'won' : current.status,
      };
    });
  }, []);

  const restart = useCallback(() => {
    escaping.current.clear();
    queueRef.current = [];
    clearCombo(false);
    comboPayoutsRef.current = [];
    setComboPayouts([]);
    setMistakeCount(0);
    setHadMistake(false);
    setAnimations({});
    setFailedArrowIds(EMPTY_FAILED);
    setState(createBoardState(level));
  }, [level]);

  const continueAnyway = useCallback(() => {
    setState((current) => continueAfterLoss(current));
  }, []);

  return {
    state,
    animations,
    failedArrowIds,
    combo,
    comboPayouts,
    mistakeCount,
    hadMistake,
    tapArrow,
    onArrowAnimationEnd,
    restart,
    continueAnyway,
  };
}

const EMPTY_FAILED: ReadonlySet<string> = new Set();
/** Gap longer than this between escapes breaks the combo. */
const COMBO_WINDOW_MS = 1500;

function initialBoard(level: Level, restored?: RunCache | null): BoardState {
  if (!isResumable(restored) || restored.levelId !== level.id) {
    return createBoardState(level);
  }
  return restoreBoardState(level, restored.remainingArrowIds, restored.lives, restored.moves);
}

function initialFailed(restored?: RunCache | null): ReadonlySet<string> {
  if (!isResumable(restored) || restored.failedArrowIds.length === 0) return EMPTY_FAILED;
  return new Set(restored.failedArrowIds);
}

function initialHadMistake(restored?: RunCache | null): boolean {
  return isResumable(restored) && restored.failedArrowIds.length > 0;
}

function initialMistakeCount(restored?: RunCache | null): number {
  return isResumable(restored) ? restored.failedArrowIds.length : 0;
}

function withId(ids: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (ids.has(id)) return ids;
  const next = new Set(ids);
  next.add(id);
  return next;
}

function withoutId(ids: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (!ids.has(id)) return ids;
  const next = new Set(ids);
  next.delete(id);
  return next;
}
