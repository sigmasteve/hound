import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

// "Quiet this one" (0279): a challenge left out of Up next. It's still on
// the Challenges tab, and its pushes still come. Saved for the account,
// with a copy on the phone so Today doesn't wait for it.

const KEY = 'today:quiet';
let cache: string[] | null = null;
const listeners = new Set<(ids: string[]) => void>();

function publish(ids: string[]) {
  cache = ids;
  listeners.forEach((l) => l(ids));
  AsyncStorage.setItem(KEY, JSON.stringify(ids)).catch(() => {});
}

export async function loadQuietChallenges(): Promise<string[]> {
  if (!cache) {
    const kept = await AsyncStorage.getItem(KEY).catch(() => null);
    if (kept) {
      try {
        cache = (JSON.parse(kept) as unknown[]).map(String);
        listeners.forEach((l) => l(cache!));
      } catch {
        // The server's answer replaces it.
      }
    }
  }
  if (supabase) {
    const { data, error } = await supabase.rpc('my_quiet_challenges');
    if (!error && Array.isArray(data)) publish(data.map(String));
  }
  return cache ?? [];
}

export async function setChallengeQuiet(challengeId: string, quiet: boolean): Promise<void> {
  const before = cache ?? [];
  publish(quiet ? [...before.filter((id) => id !== challengeId), challengeId] : before.filter((id) => id !== challengeId));
  if (!supabase) return;
  const { data, error } = await supabase.rpc('set_challenge_quiet', { p_challenge_id: challengeId, p_quiet: quiet });
  if (error) {
    publish(before);
    throw new Error(error.message || 'Couldn’t save that.');
  }
  if (Array.isArray(data)) publish(data.map(String));
}

// Signing out: the next account starts with its own.
export function forgetQuietChallenges(): void {
  cache = null;
  AsyncStorage.removeItem(KEY).catch(() => {});
}

export function useQuietChallenges(): string[] {
  const [ids, setIds] = useState<string[]>(cache ?? []);
  useEffect(() => {
    listeners.add(setIds);
    loadQuietChallenges().catch(() => {});
    return () => {
      listeners.delete(setIds);
    };
  }, []);
  return ids;
}
