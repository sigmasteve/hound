import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { getHuntLabels, setHuntLabels as saveHuntLabels } from './supabaseLabels';
import { DEFAULT_HUNT_LABELS, type HuntLabels } from './types';

interface LabelsContextValue {
  labels: HuntLabels;
  // True only while the very first fetch is in flight — same "don't
  // flash the wrong content, just start on the safe default and upgrade
  // once the real fetch resolves" shape as this app's session restore
  // and highlighted-challenge fetch use elsewhere. Never true at all
  // when Supabase isn't configured, since DEFAULT_HUNT_LABELS is the
  // real, permanent answer in that case, not a placeholder.
  loading: boolean;
  // Re-fetches the shared row — call this on a screen that should catch
  // a change someone else just saved (see SettingsScreen's own
  // useFocusEffect) rather than assuming this context's one initial
  // fetch is still current.
  refresh: () => Promise<void>;
  // Saves to the shared row *and* updates every screen using useLabels()
  // immediately, without waiting on a refetch — this is what "propagates
  // to all screens" actually means for whoever just hit Save.
  save: (next: HuntLabels) => Promise<void>;
}

const LabelsReactContext = createContext<LabelsContextValue | null>(null);

export function LabelsProvider({ children }: { children: React.ReactNode }) {
  const { user, initializing } = useAuth();
  const [labels, setLabels] = useState<HuntLabels>(DEFAULT_HUNT_LABELS);
  const [loading, setLoading] = useState(isSupabaseConfigured);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      setLabels(await getHuntLabels());
    } catch {
      // Stay on whatever labels are already showing (the default, or
      // the last successful fetch) — this never shows an error state,
      // it just quietly doesn't upgrade, same convention every other
      // real-data fetch in this app follows.
    } finally {
      setLoading(false);
    }
  }, []);

  // app_labels' own RLS only allows an authenticated read (see
  // 0015_app_labels.sql) — fetching before AuthProvider has finished
  // restoring the session, or while genuinely signed out, always comes
  // back with zero rows, which PostgREST reports as a 406 under
  // .single(). Harmless (the catch above just keeps the defaults), but
  // it doesn't need to happen: wait for a real signed-in user first.
  useEffect(() => {
    if (initializing) return;
    if (!user) {
      setLoading(false);
      return;
    }
    refresh();
  }, [user, initializing, refresh]);

  const save = useCallback(async (next: HuntLabels) => {
    await saveHuntLabels(next);
    setLabels(next);
  }, []);

  const value = useMemo<LabelsContextValue>(() => ({ labels, loading, refresh, save }), [labels, loading, refresh, save]);

  return <LabelsReactContext.Provider value={value}>{children}</LabelsReactContext.Provider>;
}

export function useLabels(): LabelsContextValue {
  const ctx = useContext(LabelsReactContext);
  if (!ctx) throw new Error('useLabels() must be called within a LabelsProvider');
  return ctx;
}
