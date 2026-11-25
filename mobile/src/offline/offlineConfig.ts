import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// Admin's switch for offline mode (0271, Overview → Status → Offline mode).
// Off until Admin turns it on (and before 0271 is run). The phone keeps the
// last answer, so it still knows with no connection.

const KEY = 'offline:enabled';
let enabled = false;
let loaded = false;
const listeners = new Set<(on: boolean) => void>();

function set(on: boolean) {
  if (on === enabled && loaded) return;
  enabled = on;
  loaded = true;
  listeners.forEach((l) => l(on));
  AsyncStorage.setItem(KEY, on ? '1' : '0').catch(() => {});
}

export function offlineEnabled(): boolean {
  return enabled;
}

// On launch and when the app comes back: the stored answer first, then the server's.
export async function refreshOfflineEnabled(): Promise<boolean> {
  if (!loaded) {
    const stored = await AsyncStorage.getItem(KEY).catch(() => null);
    if (stored !== null) set(stored === '1');
  }
  if (!supabase) return enabled;
  try {
    const { data, error } = await supabase.from('offline_config').select('enabled').eq('id', true).maybeSingle();
    if (!error) set(!!(data as any)?.enabled);
  } catch {
    // Keep the stored answer.
  }
  return enabled;
}

export function useOfflineEnabled(): boolean {
  const [on, setOn] = useState(enabled);
  useEffect(() => {
    listeners.add(setOn);
    return () => {
      listeners.delete(setOn);
    };
  }, []);
  return on;
}
