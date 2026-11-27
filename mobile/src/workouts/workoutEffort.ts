import type { HealthProvider, WorkoutSample } from '../health/types';

// A workout with no type, scored by heart rate (0280; Steve, Nov 2026: a
// 3-hour "Manual labor" earned 9,106 Move points at the flat rate though
// his heart rate was mostly light, and the watch and Whoop disagreed on
// its calories by more than 2×). Minute by minute from Health:
//   - at least `walkSpm` steps that minute: walking, which earns nothing
//     more (its steps already count);
//   - otherwise its heart rate above resting, rounded down to 5 bpm;
//   - no heart rate that minute: counted as such (the server uses the
//     workout's rate).
// The server turns the summary into points with Admin's levels.

export interface WorkoutEffort {
  rest: number;
  walk: number;
  nohr: number;
  idle: Record<string, number>;
}

const MAX_MIN = 6 * 60;

export async function workoutEffort(
  health: HealthProvider,
  w: WorkoutSample,
  rest: number,
  walkSpm: number,
): Promise<WorkoutEffort | null> {
  if (!health.getHeartRateSamples || !health.getStepBuckets || !w.durationMin || w.durationMin < 1) return null;
  const minutes = Math.min(MAX_MIN, Math.round(w.durationMin));
  const start = w.when.getTime();
  const end = start + minutes * 60_000;
  const [hr, buckets] = await Promise.all([
    health.getHeartRateSamples(new Date(start), new Date(end)).catch(() => []),
    health.getStepBuckets(new Date(start), new Date(end), 1).catch(() => []),
  ]);
  // No heart rate at all (no watch, or not allowed): leave it to the rate.
  if (hr.length === 0) return null;

  const steps = new Array<number>(minutes).fill(0);
  for (const b of buckets) {
    const i = Math.floor((b.start.getTime() - start) / 60_000);
    if (i >= 0 && i < minutes) steps[i] += b.steps;
  }
  const sum = new Array<number>(minutes).fill(0);
  const n = new Array<number>(minutes).fill(0);
  for (const s of hr) {
    const i = Math.floor((s.at - start) / 60_000);
    if (i >= 0 && i < minutes && s.bpm > 0) {
      sum[i] += s.bpm;
      n[i] += 1;
    }
  }
  // A watch reads every few seconds in a workout, a band every minute or
  // so: a minute with no reading takes the nearest within 2 minutes.
  const bpmAt = (i: number): number | null => {
    for (const d of [0, -1, 1, -2, 2]) {
      const j = i + d;
      if (j >= 0 && j < minutes && n[j] > 0) return sum[j] / n[j];
    }
    return null;
  };

  const out: WorkoutEffort = { rest, walk: 0, nohr: 0, idle: {} };
  for (let i = 0; i < minutes; i++) {
    if (steps[i] >= walkSpm) {
      out.walk++;
      continue;
    }
    const bpm = bpmAt(i);
    if (bpm === null) {
      out.nohr++;
      continue;
    }
    const above = Math.max(0, Math.floor((bpm - rest) / 5) * 5);
    out.idle[String(above)] = (out.idle[String(above)] ?? 0) + 1;
  }
  return out;
}

// Workouts that already earn only their steps (walks, runs, hikes) don't
// need it.
export function wantsEffort(w: WorkoutSample): boolean {
  return !!w.durationMin && w.source !== 'manual' && !/walk|run|hik|golf/i.test(w.name);
}
