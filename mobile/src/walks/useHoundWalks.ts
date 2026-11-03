import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useHealthProvider } from '../health/HealthContext';
import { isSupabaseConfigured } from '../lib/supabase';
import { localDayKey } from '../water/water';
import { spotWalks, type WalksData } from './walks';
import { getWalks, saveWalks } from './walksApi';

// The Kennel's walks: each time it comes into view, read today's and
// yesterday's steps in 15-minute buckets from Health, spot the walks in
// them, save them (0161), and show what comes back, finds included.
// Yesterday too, so a late walk still finds something after midnight.

const MIN_GAP_MS = 2 * 60_000;

export interface HoundWalksState {
  data: WalksData | null;
  // False before 0161 has run: nothing about walks shows.
  available: boolean;
  today: string;
  refresh(): void;
}

export function useHoundWalks(enabled = true): HoundWalksState {
  const health = useHealthProvider();
  const [data, setData] = useState<WalksData | null>(null);
  const [available, setAvailable] = useState(true);
  const [today, setToday] = useState(localDayKey());
  const lastSync = useRef(0);

  const sync = useCallback(
    async (force: boolean) => {
      const preview = (globalThis as any).__previewWalks as WalksData | undefined;
      if (preview) {
        setData(preview);
        return;
      }
      if (!isSupabaseConfigured) return;
      const now = new Date();
      const day = localDayKey(now);
      setToday(day);
      if (!force && Date.now() - lastSync.current < MIN_GAP_MS) return;
      lastSync.current = Date.now();
      try {
        const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        const buckets = health.getStepBuckets ? await health.getStepBuckets(yesterday, now).catch(() => []) : [];
        const walks = spotWalks(buckets);
        const before = walks.filter((w) => w.start < midnight);
        const after = walks.filter((w) => w.start >= midnight);
        if (before.length) await saveWalks(localDayKey(yesterday), before).catch(() => null);
        setData(after.length ? await saveWalks(day, after) : await getWalks(day));
        setAvailable(true);
      } catch (e) {
        if (e instanceof Error && /my_walks|save_hound_walks/.test(e.message)) setAvailable(false);
      }
    },
    [health],
  );

  useFocusEffect(
    useCallback(() => {
      if (enabled) sync(false);
    }, [enabled, sync]),
  );

  return { data, available, today, refresh: () => sync(true) };
}
