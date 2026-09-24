import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { getOrgLabels } from '../organizations/supabaseOrganizations';
import { getHuntLabels } from './supabaseLabels';
import { DEFAULT_HUNT_LABELS, type HuntLabels } from './types';

interface LabelsContextValue {
  // The effective labels for the signed-in user right now: their own
  // org's override (organization_labels, see 0036_organization_labels.sql)
  // when they're in an org that's set one, otherwise the app-wide
  // app_labels default — see refresh() below for exactly how that's
  // decided. Every screen that just displays Hound/Fox/Out copy
  // (HomeScreen, ChallengesScreen, ChallengeDetailScreen, CreateScreen)
  // wants this. AdminScreen's own "Chase labels" card is the one
  // exception — it edits the raw app-wide default directly (via
  // ../labels/supabaseLabels), not through this context, precisely
  // because this value can differ from that default for an admin who
  // happens to belong to an org with its own override.
  labels: HuntLabels;
  // True only while the very first fetch is in flight — same "don't
  // flash the wrong content, just start on the safe default and upgrade
  // once the real fetch resolves" shape as this app's session restore
  // and highlighted-challenge fetch use elsewhere. Never true at all
  // when Supabase isn't configured, since DEFAULT_HUNT_LABELS is the
  // real, permanent answer in that case, not a placeholder.
  loading: boolean;
  // Re-resolves the effective labels above — call this on a screen that
  // should catch a change someone else just saved (see SettingsScreen's
  // own useFocusEffect) rather than assuming this context's one initial
  // fetch is still current. Also what AdminScreen calls after saving the
  // app-wide default, so anyone without their own org override sees the
  // update without restarting the app.
  refresh: () => Promise<void>;
}

const LabelsReactContext = createContext<LabelsContextValue | null>(null);

export function LabelsProvider({ children }: { children: React.ReactNode }) {
  const { user, initializing } = useAuth();
  const [labels, setLabels] = useState<HuntLabels>(DEFAULT_HUNT_LABELS);
  const [loading, setLoading] = useState(isSupabaseConfigured);

  // Org override wins when one exists; otherwise the app-wide default.
  // The org lookup only runs for someone actually in an org — for
  // everyone else (still the overwhelming majority) this is exactly the
  // one query it always was.
  const organizationId = user?.organizationId ?? null;
  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      const [global, org] = await Promise.all([
        getHuntLabels(),
        organizationId ? getOrgLabels(organizationId) : Promise.resolve(null),
      ]);
      setLabels(org ?? global);
    } catch {
      // Stay on whatever labels are already showing (the default, or
      // the last successful fetch) — this never shows an error state,
      // it just quietly doesn't upgrade, same convention every other
      // real-data fetch in this app follows.
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

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

  const value = useMemo<LabelsContextValue>(() => ({ labels, loading, refresh }), [labels, loading, refresh]);

  return <LabelsReactContext.Provider value={value}>{children}</LabelsReactContext.Provider>;
}

export function useLabels(): LabelsContextValue {
  const ctx = useContext(LabelsReactContext);
  if (!ctx) throw new Error('useLabels() must be called within a LabelsProvider');
  return ctx;
}
