import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { HighScoreRepository } from './HighScoreRepository';

const INTERVAL_MS = 5 * 60_000;

/**
 * Quietly refreshes the given level's high-score cache every 5 minutes while
 * the app is foregrounded, so win screens stay comparable across devices.
 */
export function useHighScoreRefresh(levelId: string | null): void {
  const levelRef = useRef(levelId);
  levelRef.current = levelId;

  useEffect(() => {
    if (!levelId) return;

    const tick = () => {
      const id = levelRef.current;
      if (id) void HighScoreRepository.refreshIfStale(id);
    };

    tick();
    const interval = setInterval(tick, INTERVAL_MS);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') tick();
    });

    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [levelId]);
}
