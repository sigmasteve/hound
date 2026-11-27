import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

// Customize Today (0278, the streamlining, Steve Nov 2026): Today opens
// on the basics, and the extras are switches here, off for everyone until
// they turn one on. Saved per account on the server, with a copy on the
// phone so Today doesn't wait for it (and works offline).
export type TodayExtra = 'week' | 'rank' | 'journey' | 'fasting_card' | 'holiday' | 'hound_top';
export type TodayExtras = Record<TodayExtra, boolean>;

export const TODAY_EXTRAS: { id: TodayExtra; label: string; detail: string }[] = [
  { id: 'week', label: 'Week in review', detail: 'Last week’s recap, Monday until Tuesday noon.' },
  { id: 'rank', label: 'Step rank', detail: 'Where today’s steps put you among your friends.' },
  { id: 'journey', label: 'Journey', detail: 'Your Journey’s next stop, when you’re on one.' },
  { id: 'fasting_card', label: 'Fasting card', detail: 'Swipe Your day sideways to the full fasting card.' },
  { id: 'holiday', label: 'Holiday decorations', detail: 'The countdown, the trims and the falling snow.' },
];

export const NO_EXTRAS: TodayExtras = { week: false, rank: false, journey: false, fasting_card: false, holiday: false, hound_top: false };

const KEY = 'today:extras';
let cache: TodayExtras | null = null;
let cacheUser: string | null = null;
const listeners = new Set<(e: TodayExtras) => void>();

function clean(raw: unknown): TodayExtras {
  const out = { ...NO_EXTRAS };
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(out) as TodayExtra[]) {
      if ((raw as Record<string, unknown>)[k] === true) out[k] = true;
    }
  }
  return out;
}

function publish(e: TodayExtras) {
  cache = e;
  listeners.forEach((l) => l(e));
}

async function userId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
  return data.session?.user.id ?? null;
}

// The phone's copy first, then the server's.
export async function loadTodayExtras(): Promise<TodayExtras> {
  const uid = await userId();
  if (uid !== cacheUser) {
    cacheUser = uid;
    cache = null;
  }
  if (!cache && uid) {
    const kept = await AsyncStorage.getItem(`${KEY}:${uid}`).catch(() => null);
    if (kept) {
      try {
        publish(clean(JSON.parse(kept)));
      } catch {
        // A bad copy: the server's answer replaces it.
      }
    }
  }
  if (supabase && uid) {
    const { data, error } = await supabase.rpc('my_today_prefs');
    if (!error) {
      const e = clean(data);
      publish(e);
      AsyncStorage.setItem(`${KEY}:${uid}`, JSON.stringify(e)).catch(() => {});
    }
  }
  return cache ?? NO_EXTRAS;
}

export async function setTodayExtra(id: TodayExtra, on: boolean): Promise<void> {
  const before = cache ?? NO_EXTRAS;
  const next = { ...before, [id]: on };
  publish(next);
  const uid = await userId();
  if (uid) AsyncStorage.setItem(`${KEY}:${uid}`, JSON.stringify(next)).catch(() => {});
  if (!supabase) return;
  const { error } = await supabase.rpc('set_today_prefs', { p_prefs: next });
  if (error) {
    publish(before);
    if (uid) AsyncStorage.setItem(`${KEY}:${uid}`, JSON.stringify(before)).catch(() => {});
    throw new Error('Couldn’t save that. Try again in a moment.');
  }
}

// All off until loaded, so nothing extra flashes in and then goes.
export function useTodayExtras(): TodayExtras {
  const [e, setE] = useState<TodayExtras>(cache ?? NO_EXTRAS);
  useEffect(() => {
    listeners.add(setE);
    loadTodayExtras().catch(() => {});
    return () => {
      listeners.delete(setE);
    };
  }, []);
  return e;
}

// Your day's taps, opening Customize Today, Up next's button and Play
// your turns (0279), for Admin's numbers.
export type TodayTap = 'steps' | 'fasting' | 'move' | 'water' | 'customize' | 'upnext' | 'play_start' | 'play_turn' | 'play_done' | 'play_stop';

export function noteTodayTap(what: TodayTap): void {
  if (!supabase) return;
  Promise.resolve(supabase.rpc('note_today_tap', { p_what: what })).catch(() => {});
}
