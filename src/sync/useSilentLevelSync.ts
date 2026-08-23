import { useEffect, useRef } from 'react';
import { useProgressStore } from '../store/progressStore';
import { useCatalogStamp } from '../store/catalogStamp';
import { LevelRepository } from './LevelRepository';
import { isSupabaseConfigured } from './supabaseClient';

/**
 * One background check at process start. No spinner, no toast, no retry UI.
 * A miss (offline, empty table, missing env) is indistinguishable from a hit
 * as far as the player is concerned.
 */
export function useSilentLevelSync(): void {
  const hydrate = useProgressStore((state) => state.hydrate);
  const hydrated = useProgressStore((state) => state.hydrated);
  const currentCuratedLevel = useProgressStore((state) => state.currentCuratedLevel);
  const hydrateStamp = useCatalogStamp((state) => state.hydrate);
  const started = useRef(false);

  useEffect(() => {
    void hydrate();
    void hydrateStamp();
  }, [hydrate, hydrateStamp]);

  useEffect(() => {
    if (!hydrated || started.current) return;
    if (!isSupabaseConfigured()) return;
    started.current = true;
    void LevelRepository.syncOnLaunch(currentCuratedLevel);
  }, [hydrated, currentCuratedLevel]);
}
