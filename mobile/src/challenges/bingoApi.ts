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
    .select('user_id, category, first_logged_at, source, workout_name, workout_at')
    .eq('challenge_id', challengeId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    userId: row.user_id,
    category: row.category as BingoCategory,
    firstLoggedAt: row.first_logged_at as string,
    source: (row.source as BingoFillSource | null) ?? 'auto',
    workoutName: row.workout_name as string | null,
    workoutAt: row.workout_at as string | null,
  }));
}

// Fills the caller's own square — `workout` is a snapshot of whichever
// WorkoutSample is responsible, for both fill sources (see
// BingoProgressRow's own comment).
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
  workout: { name: string; when: Date },
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
  };
  const { error } = await client
    .from('bingo_progress')
    .upsert(row, { onConflict: 'challenge_id,user_id,category', ignoreDuplicates: source === 'auto' });
  if (error) throw new Error(error.message);
}
