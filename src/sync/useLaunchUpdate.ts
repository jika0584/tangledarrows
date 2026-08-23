import { useCallback, useEffect, useState } from 'react';
import * as Updates from 'expo-updates';

export type UpdatePhase = 'idle' | 'available' | 'downloading' | 'error';

/**
 * Release APKs only. Expo Go and Metro (`__DEV__`) skip this — those
 * environments reject the updates API.
 */
export function useLaunchUpdate(): {
  phase: UpdatePhase;
  apply: () => Promise<void>;
  dismiss: () => void;
} {
  const [phase, setPhase] = useState<UpdatePhase>('idle');

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;

    let cancelled = false;
    void (async () => {
      try {
        const result = await Updates.checkForUpdateAsync();
        if (!cancelled && result.isAvailable) setPhase('available');
      } catch {
        // Offline, misconfigured, or Expo Go: keep playing the installed build.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const apply = useCallback(async () => {
    if (__DEV__ || !Updates.isEnabled) return;
    setPhase('downloading');
    try {
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    } catch {
      setPhase('error');
    }
  }, []);

  const dismiss = useCallback(() => {
    setPhase('idle');
  }, []);

  return { phase, apply, dismiss };
}
