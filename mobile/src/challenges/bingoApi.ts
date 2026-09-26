import { supabase } from '../lib/supabase';
import type { BingoCategory, BingoFillSource, BingoProgressRow } from './bingo';

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

async function requireUserId(): Promise<string> {
  const { data } = await requireClient().auth.getUser();
  if (!data.user) throw new Error('Sign in to do that.');
  return data.user.id;
}

// Every category any participant has ever filled for this challenge — see
// 0052_bingo_progress.sql's "Participants can view bingo progress" policy
// (any participant can read the whole challenge's rows, needed for the
// squares-filled leaderboard, not just the caller's own card).
export async function listBingoProgress(challengeId: string): Promise<BingoProgressRow[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('bingo_progress')
    .select('user_id, category, first_logged_at, source, workout_name, workout_at, workout_key')
    .eq('challenge_id', challengeId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    userId: row.user_id,
    category: row.category as BingoCategory,
    firstLoggedAt: row.first_logged_at as string,
    source: (row.source as BingoFillSource | null) ?? 'auto',
    workoutName: row.workout_name as string | null,
    workoutAt: row.workout_at as string | null,
    workoutKey: row.workout_key as string | null,
  }));
}

// Fills the caller's own square — `workout` is a snapshot of whichever
// WorkoutSample is responsible, for both fill sources (see
// BingoProgressRow's own comment). `workout.id` (WorkoutSample.id) is
// what actually stops the same real workout filling two different
// squares (0054_bingo_workout_key.sql's own unique index) — `when` is
// stored too, but only ever for display, not as an identity check.
//
// The two sources behave differently on a repeat call for the same
// category, by design: 'auto' (syncBingoProgressFromDevice, which
// re-classifies every recent workout on every sync rather than tracking
// which ones it's already seen) ignores the conflict — it must never
// clobber a person's own manual correction just because a later sync
// reclassifies something. 'manual' (someone tapping a square and picking
// a workout) is a real update — re-picking a different workout for an
// already-filled square is exactly the point of letting them tap it
// again, not something to silently refuse.
export async function recordBingoProgress(
  challengeId: string,
  category: BingoCategory,
  source: BingoFillSource,
  workout: { id: string; name: string; when: Date },
): Promise<void> {
  const client = requireClient();
  const userId = await requireUserId();
  const row = {
    challenge_id: challengeId,
    user_id: userId,
    category,
    source,
    workout_name: workout.name,
    workout_at: workout.when.toISOString(),
    workout_key: workout.id,
  };
  const { error } = await client
    .from('bingo_progress')
    .upsert(row, { onConflict: 'challenge_id,user_id,category', ignoreDuplicates: source === 'auto' });
  if (error) throw new Error(error.message);
}

// Undoes an accidental manual link — the square goes back to unfilled,
// or to whatever the next device sync classifies for that category on
// its own if a matching workout is still in range by then (removing a
// manual link un-does the override, it doesn't block auto-fill from
// ever touching that category again). RLS itself (0054's own delete
// policy) refuses this for anything but the caller's own 'manual' rows
// — an 'auto' fill was never something a person "added" to begin with,
// and the very next sync would just put it right back regardless.
export async function unlinkBingoProgress(challengeId: string, category: BingoCategory): Promise<void> {
  const client = requireClient();
  const userId = await requireUserId();
  const { error } = await client
    .from('bingo_progress')
    .delete()
    .eq('challenge_id', challengeId)
    .eq('user_id', userId)
    .eq('category', category);
  if (error) throw new Error(error.message);
}
