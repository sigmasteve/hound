import { supabase } from '../lib/supabase';
import type { HealthProvider, WorkoutSample } from '../health/types';
import { phoneStepsBetween } from './loggedWorkouts';
import { wantsEffort, workoutEffort, type WorkoutEffort } from './workoutEffort';

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
  // And for a workout with no type, how hard it was, minute by minute
  // from heart rate (0280). Only the last few days (a few Health reads
  // each), and only where Health could say, so an older workout keeps
  // what it was sent before.
  const extra = new Map<string, { steps_during?: number; effort?: WorkoutEffort }>();
  if (health) {
    const since = Date.now() - STEPS_DAYS * 86400000;
    const recent = workouts.filter((w) => w.when.getTime() >= since && !!w.durationMin);
    const rest = recent.some(wantsEffort) && health.getRestingHeartRate ? await health.getRestingHeartRate().catch(() => null) : null;
    const walkSpm = rest ? await walkStepsPerMinute(client) : 60;
    for (const w of recent) {
      const e: { steps_during?: number; effort?: WorkoutEffort } = {};
      const n = await phoneStepsBetween(health, w.when, new Date(w.when.getTime() + w.durationMin! * 60000));
      if (n !== null) e.steps_during = n;
      if (rest && wantsEffort(w)) {
        const effort = await workoutEffort(health, w, rest, walkSpm).catch(() => null);
        if (effort) e.effort = effort;
      }
      if (e.steps_during !== undefined || e.effort) extra.set(w.id, e);
    }
  }
  // One upsert per set of columns, so a row never clears what it doesn't
  // send.
  const batches = new Map<string, Record<string, unknown>[]>();
  for (const w of workouts) {
    const r = { ...row(w), ...(extra.get(w.id) ?? {}) };
    const key = Object.keys(r).sort().join(',');
    batches.set(key, [...(batches.get(key) ?? []), r]);
  }
  for (const batch of batches.values()) {
    let { error } = await client.from('workout_history').upsert(batch, { onConflict: 'user_id,source_id' });
    // Before 0280 is run there's no effort column: send the rest.
    if (error && /effort/.test(error.message)) {
      ({ error } = await client
        .from('workout_history')
        .upsert(batch.map(({ effort: _e, ...rest }) => rest), { onConflict: 'user_id,source_id' }));
    }
    if (error) throw new Error(error.message);
  }
}

// What counts as a walking minute (Admin → Bones → Move points; 0280).
async function walkStepsPerMinute(client: ReturnType<typeof requireClient>): Promise<number> {
  const { data, error } = await client.from('move_config').select('hr_walk_spm').eq('id', true).maybeSingle();
  const n = Number((data as { hr_walk_spm?: number } | null)?.hr_walk_spm);
  return !error && Number.isFinite(n) && n > 0 ? n : 60;
}

const STEPS_DAYS = 3;
