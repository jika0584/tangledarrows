import { useCallback, useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';

/**
 * Wall-clock timer that is never shown during play. It pauses in the
 * background and while the board is not in the playing state.
 */
export function useElapsedTimer(active: boolean, initialMs = 0): {
  getElapsed: () => number;
  reset: (ms?: number) => void;
} {
  const accumulated = useRef(initialMs);
  const segmentStart = useRef<number | null>(null);
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const activeRef = useRef(active);
  activeRef.current = active;

  const freeze = useCallback((): number => {
    if (segmentStart.current != null) {
      accumulated.current += Date.now() - segmentStart.current;
      segmentStart.current = null;
    }
    return accumulated.current;
  }, []);

  const resumeClock = useCallback(() => {
    if (segmentStart.current != null) return;
    segmentStart.current = Date.now();
  }, []);

  const sync = useCallback(() => {
    const running = activeRef.current && appState.current === 'active';
    if (running) resumeClock();
    else freeze();
  }, [freeze, resumeClock]);

  useEffect(() => {
    sync();
  }, [active, sync]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') freeze();
      appState.current = next;
      sync();
    });
    return () => sub.remove();
  }, [freeze, sync]);

  const getElapsed = useCallback((): number => {
    if (segmentStart.current == null) return accumulated.current;
    return accumulated.current + (Date.now() - segmentStart.current);
  }, []);

  const reset = useCallback(
    (ms = 0) => {
      accumulated.current = ms;
      segmentStart.current = activeRef.current && appState.current === 'active' ? Date.now() : null;
    },
    [],
  );

  return { getElapsed, reset };
}

export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${minutes}:${pad(seconds)}`;
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}
