import { supabase } from '../lib/supabase';
import type { HealthProvider, WorkoutSample } from '../health/types';
import { phoneStepsBetween } from './loggedWorkouts';

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
export async function recordWorkoutHistory(userId: string, workouts: WorkoutSample[], health?: HealthProvider): Promise<void> {
  // Workouts logged by hand are already on the server (0204), and the
  // server won't take one written from here.
  workouts = workouts.filter((w) => w.source !== 'manual');
  if (workouts.length === 0) return;
  const client = requireClient();
  const row = (w: WorkoutSample) => ({
    user_id: userId,
    source_id: w.id,
    name: w.name,
    occurred_at: w.when.toISOString(),
    source: w.source,
    distance_mi: w.distanceMi ?? null,
    avg_heart_rate: w.avgHeartRate ?? null,
    duration_min: w.durationMin ?? null,
  });
  // The steps taken during each recent workout (0277): they're already in
  // the day's steps, so Move points takes them off the workout's points.
  // Only the last few days (a Health read each), and only where Health
  // could say, so an older workout keeps what it was sent before.
  const steps = new Map<string, number>();
  if (health) {
    const since = Date.now() - STEPS_DAYS * 86400000;
    for (const w of workouts) {
      if (w.when.getTime() < since || !w.durationMin) continue;
      const n = await phoneStepsBetween(health, w.when, new Date(w.when.getTime() + w.durationMin * 60000));
      if (n !== null) steps.set(w.id, n);
    }
  }
  const withSteps = workouts.filter((w) => steps.has(w.id)).map((w) => ({ ...row(w), steps_during: steps.get(w.id)! }));
  const without = workouts.filter((w) => !steps.has(w.id)).map(row);
  for (const batch of [withSteps, without]) {
    if (batch.length === 0) continue;
    const { error } = await client.from('workout_history').upsert(batch, { onConflict: 'user_id,source_id' });
    if (error) throw new Error(error.message);
  }
}

const STEPS_DAYS = 3;
