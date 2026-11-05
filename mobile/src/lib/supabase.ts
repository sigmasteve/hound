import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Expo inlines EXPO_PUBLIC_* env vars into the JS bundle at build time (see
// .env.example) — there's no server involved, so this is the same
// publishable key a web app would ship to the browser. It's safe to
// expose because every table it can reach is behind Row Level Security
// (see supabase/migrations/0001_challenges_schema.sql); it grants no
// access on its own. Supabase calls this the "publishable" key now
// (`sb_publishable_...`) — projects created before ~Nov 2025 may still
// show it as the "anon" key in their dashboard (an older, JWT-shaped
// value); createClient() accepts either, this project just standardizes
// on the current name.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(url && publishableKey);

// null until a project is wired up — every caller in src/auth and
// src/challenges checks isSupabaseConfigured (or gets a thrown error from
// requireClient()) and falls back to mock data instead of crashing, the
// same pattern src/health uses for a native module that isn't linked.
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, publishableKey as string, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
      // What this app can handle, so the server can keep older apps out
      // of things they'd crash on (0118_bingo_join_guard.sql).
      global: { headers: { 'x-hound-features': 'hound-bingo' } },
    })
  : null;

// Keep the sign-in fresh only while Hound is on screen, as Supabase asks
// of phone apps: refreshing stops in the background and starts again on
// the way back, so the token is renewed as soon as the app is open again
// rather than on the first request after a long sleep.
if (supabase) {
  const client = supabase;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') client.auth.startAutoRefresh();
    else client.auth.stopAutoRefresh();
  });
}

// When the stored sign-in can't be refreshed (say, a weak signal as the
// app wakes up), supabase-js sends the request as signed out, and the
// server refuses it with a row-level security error even though Hound
// still shows you as signed in. This runs a write, and on that error
// refreshes the sign-in and tries once more; if there's still no
// sign-in, it says so plainly.
export async function withFreshSession<T extends { error: { code?: string; message: string } | null }>(
  run: () => PromiseLike<T>,
): Promise<T> {
  const first = await run();
  if (!supabase || first.error?.code !== '42501') return first;
  const { data } = await supabase.auth.refreshSession();
  if (!data.session) {
    return { ...first, error: { ...first.error, message: 'Your sign-in has run out. Sign out and back in, then try again.' } };
  }
  return run();
}

// The signed-in user's id, from the session already stored on the phone.
// auth.getUser() asks the server every time, and Today's load calls this
// once per challenge and list, so that was a few dozen requests per open.
// The server still checks who's asking on every query (Row Level
// Security), so the stored session is enough here.
export async function signedInUserId(): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('Sign in to do that.');
  return id;
}
