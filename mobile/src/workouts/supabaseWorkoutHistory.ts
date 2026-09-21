import { supabase } from '../lib/supabase';
import type { WorkoutSample } from '../health/types';

// Persists WorkoutSample rows (read live from HealthKit/Health Connect
// via getRecentWorkouts()) so there's a real history to analyze later —
// see 0029_workout_history.sql for the table/RLS and the admin-only
// archive function this doesn't call directly.

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

// Upserts every fetched workout, keyed by (user_id, source_id) — the
// same provider-issued id WorkoutSample.id already carries. Safe to call
// on every Home load: same "it's an upsert, re-running it is harmless"
// reasoning ChallengeDetailScreen's syncFromDevice and the steps sync
// already rely on.
export async function recordWorkoutHistory(userId: string, workouts: WorkoutSample[]): Promise<void> {
  if (workouts.length === 0) return;
  const client = requireClient();
  const { error } = await client.from('workout_history').upsert(
    workouts.map((w) => ({
      user_id: userId,
      source_id: w.id,
      name: w.name,
      occurred_at: w.when.toISOString(),
      source: w.source,
      distance_mi: w.distanceMi ?? null,
      avg_heart_rate: w.avgHeartRate ?? null,
      duration_min: w.durationMin ?? null,
    })),
    { onConflict: 'user_id,source_id' },
  );
  if (error) throw new Error(error.message);
}
