import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { isSupabaseConfigured } from '../lib/supabase';
import { localDayKey } from '../water/water';
import { getTogether, type Together } from './together';

// The playdate, walks together and the dog park (0170): loaded when the
// Kennel comes into view, and again as the day's walks come in.

export interface TogetherState {
  data: Together | null;
  // False before 0170 has run: nothing about it shows.
  available: boolean;
}

export function useTogether(walksVersion: unknown): TogetherState {
  const [data, setData] = useState<Together | null>(null);
  const [available, setAvailable] = useState(true);

  const reload = useCallback(() => {
    const preview = (globalThis as any).__previewTogether as Together | undefined;
    if (preview) {
      setData(preview);
      return;
    }
    if (!isSupabaseConfigured) return;
    getTogether(localDayKey())
      .then((t) => {
        setData(t);
        setAvailable(true);
      })
      .catch((e) => {
        if (e instanceof Error && /my_together/.test(e.message)) setAvailable(false);
      });
  }, []);

  useFocusEffect(reload);
  useEffect(reload, [walksVersion, reload]);
  return { data, available };
}
