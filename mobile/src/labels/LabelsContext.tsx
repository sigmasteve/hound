import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { isSupabaseConfigured } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { getOrgLabels } from '../organizations/supabaseOrganizations';
import { getHuntLabels } from './supabaseLabels';
import { DEFAULT_HUNT_LABELS, type HuntLabels } from './types';

interface LabelsContextValue {
  // True only while the very first (global-default) fetch is in flight —
  // same "don't flash the wrong content, just start on the safe default
  // and upgrade once the real fetch resolves" shape as this app's session
  // restore and highlighted-challenge fetch use elsewhere. Never true at
  // all when Supabase isn't configured, since DEFAULT_HUNT_LABELS is the
  // real, permanent answer in that case, not a placeholder.
  loading: boolean;
  // Re-fetches the app-wide default AND drops every cached per-org
  // lookup, so a label change saved elsewhere (AdminScreen's own global
  // editor, or an org admin's own OrgDetailScreen save) is picked up on
  // the next labelsForOrg call rather than serving a stale cached value
  // indefinitely. Call this on a screen that should catch such a change
  // (see SettingsScreen's own useFocusEffect) or after saving one.
  refresh: () => Promise<void>;
  // The right label set for a SPECIFIC challenge (or draft) — pass its
  // own organizationId, not the viewer's. null/undefined means a
  // global challenge and returns the app-wide default directly.
  // Otherwise returns that org's own override once loaded (falling back
  // to the app-wide default meanwhile, or permanently if that org never
  // set one) — see GitHub issue #158. A challenge's wording is a property
  // of the challenge itself, not of whoever's currently looking at it:
  // two different challenges the same person is in (an org one and a
  // global one, say) can and should read differently, and a platform
  // admin looking at someone else's org's challenge should see that
  // org's own words, not their own membership (or lack of one).
  labelsForOrg: (organizationId: string | null | undefined) => HuntLabels;
}

const LabelsReactContext = createContext<LabelsContextValue | null>(null);

export function LabelsProvider({ children }: { children: React.ReactNode }) {
  const { user, initializing } = useAuth();
  const [globalLabels, setGlobalLabels] = useState<HuntLabels>(DEFAULT_HUNT_LABELS);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  // undefined = never fetched, null = fetched, no override (use the
  // global default), HuntLabels = fetched, has its own override.
  const [orgLabelsCache, setOrgLabelsCache] = useState<Record<string, HuntLabels | null>>({});
  // A ref, not state — this only ever needs to dedupe concurrent
  // in-flight fetches for the same org, never to trigger a render itself
  // (orgLabelsCache already does that once the fetch resolves).
  const fetchingOrgIds = useRef<Set<string>>(new Set());

  const refreshGlobal = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      setGlobalLabels(await getHuntLabels());
    } catch {
      // Stay on whatever's already showing — same convention every other
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
    refreshGlobal();
  }, [user, initializing, refreshGlobal]);

  const ensureOrgLabels = useCallback((organizationId: string) => {
    if (!isSupabaseConfigured) return;
    if (organizationId in orgLabelsCache || fetchingOrgIds.current.has(organizationId)) return;
    fetchingOrgIds.current.add(organizationId);
    getOrgLabels(organizationId)
      .then((org) => setOrgLabelsCache((cur) => ({ ...cur, [organizationId]: org })))
      .catch(() => {
        // Leave it un-cached — the next render's labelsForOrg call just
        // tries again, same "quietly don't upgrade" convention as above.
      })
      .finally(() => {
        fetchingOrgIds.current.delete(organizationId);
      });
  }, [orgLabelsCache]);

  const labelsForOrg = useCallback(
    (organizationId: string | null | undefined): HuntLabels => {
      if (!organizationId) return globalLabels;
      const cached = orgLabelsCache[organizationId];
      if (cached !== undefined) return cached ?? globalLabels;
      // Kicks off the fetch (deduped via fetchingOrgIds) and returns the
      // global default for THIS render — orgLabelsCache updating once it
      // resolves triggers a re-render that picks up the real value.
      ensureOrgLabels(organizationId);
      return globalLabels;
    },
    [globalLabels, orgLabelsCache, ensureOrgLabels],
  );

  const refresh = useCallback(async () => {
    setOrgLabelsCache({});
    await refreshGlobal();
  }, [refreshGlobal]);

  const value = useMemo<LabelsContextValue>(() => ({ loading, refresh, labelsForOrg }), [loading, refresh, labelsForOrg]);

  return <LabelsReactContext.Provider value={value}>{children}</LabelsReactContext.Provider>;
}

export function useLabels(): LabelsContextValue {
  const ctx = useContext(LabelsReactContext);
  if (!ctx) throw new Error('useLabels() must be called within a LabelsProvider');
  return ctx;
}
