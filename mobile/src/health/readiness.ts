import type { WorkoutSample } from './types';

// Phase 1 of the readiness plan doc: training load only, via the
// acute:chronic workload ratio (ACWR) — the standard sports-science
// metric for "is this week's training a sustainable step up from the
// last month, or a spike." Phase 2 adds a resting-HR recovery signal on
// top of this; Phase 3 adds HRV/sleep, opt-in. See the plan doc for the
// full model and why it's a small rule-based module rather than
// anything ML-flavored — every label here ships with the reasoning that
// produced it.
export type ReadinessLabel = 'overload_risk' | 'slow_down' | 'on_track' | 'ready_for_more' | 'insufficient_data';

export interface ReadinessResult {
  label: ReadinessLabel;
  reason: string;
  // This week's total training minutes, and the last 4 weeks' own
  // average weekly minutes (the two numbers `reason` is built from) —
  // exposed so the UI can show them as their own readout tiles without
  // recomputing. null when there isn't a real chronic baseline yet.
  acuteMinutes: number;
  chronicWeeklyAvgMinutes: number | null;
  acwr: number | null;
}

const MS_PER_DAY = 86_400_000;

// Below this many days of workout history, there's no real 4-week
// baseline to compare this week against yet — a brand-new account (or
// one that just connected a device) would otherwise read as an extreme
// spike simply for having any history at all. See the plan doc's own
// "Cold start" risk.
const MIN_HISTORY_DAYS = 21;

// The standard ACWR bands (sports-science defaults, tuned for
// structured athletic training) — see the plan doc's "Threshold tuning"
// risk on why these may need adjusting for casual step/workout logging,
// and why they're named constants rather than inline numbers.
const OVERLOAD_THRESHOLD = 1.5;
const SLOW_DOWN_THRESHOLD = 1.3;
const READY_FOR_MORE_THRESHOLD = 0.8;

function sumMinutesInWindow(workouts: WorkoutSample[], now: Date, daysBack: number): number {
  const start = now.getTime() - daysBack * MS_PER_DAY;
  return workouts.reduce((sum, w) => {
    if (!w.durationMin) return sum;
    const t = w.when.getTime();
    return t > start && t <= now.getTime() ? sum + w.durationMin : sum;
  }, 0);
}

function oldestWorkoutDate(workouts: WorkoutSample[]): Date | null {
  return workouts.reduce<Date | null>((oldest, w) => (!oldest || w.when < oldest ? w.when : oldest), null);
}

export function computeReadiness(workouts: WorkoutSample[], now: Date = new Date()): ReadinessResult {
  const oldest = oldestWorkoutDate(workouts);
  const historyDays = oldest ? Math.floor((now.getTime() - oldest.getTime()) / MS_PER_DAY) : 0;
  const acuteMinutes = sumMinutesInWindow(workouts, now, 7);

  if (historyDays < MIN_HISTORY_DAYS) {
    return {
      label: 'insufficient_data',
      reason: oldest
        ? "Still building your baseline — readiness needs a few weeks of workout history to compare against."
        : 'Log a workout to start building a readiness signal.',
      acuteMinutes,
      chronicWeeklyAvgMinutes: null,
      acwr: null,
    };
  }

  const chronicWeeklyAvgMinutes = sumMinutesInWindow(workouts, now, 28) / 4;
  if (chronicWeeklyAvgMinutes === 0) {
    return {
      label: 'insufficient_data',
      reason: 'Log a few more workouts to unlock a readiness signal.',
      acuteMinutes,
      chronicWeeklyAvgMinutes: 0,
      acwr: null,
    };
  }

  const acwr = acuteMinutes / chronicWeeklyAvgMinutes;
  const pctChange = Math.round((acwr - 1) * 100);

  if (acwr > OVERLOAD_THRESHOLD) {
    return {
      label: 'overload_risk',
      reason: `This week's training is ${pctChange}% above your last month's average — that's a sharp jump. Consider an easier day.`,
      acuteMinutes,
      chronicWeeklyAvgMinutes,
      acwr,
    };
  }
  if (acwr > SLOW_DOWN_THRESHOLD) {
    return {
      label: 'slow_down',
      reason: `This week's training is ${pctChange}% above your last month's average. Ease up a bit if you're feeling it.`,
      acuteMinutes,
      chronicWeeklyAvgMinutes,
      acwr,
    };
  }
  if (acwr < READY_FOR_MORE_THRESHOLD) {
    return {
      label: 'ready_for_more',
      reason: `This week's training is ${Math.abs(pctChange)}% below your last month's average — there's room to add more.`,
      acuteMinutes,
      chronicWeeklyAvgMinutes,
      acwr,
    };
  }
  return {
    label: 'on_track',
    reason: "This week's training load is in line with your last month's average.",
    acuteMinutes,
    chronicWeeklyAvgMinutes,
    acwr,
  };
}

// StatusTone lives in theme/tokens.ts, not here — this module stays free
// of any RN/theme dependency (see the plan doc's touch list: pure logic,
// unit-testable on its own), so it only names the tone, never resolves
// it to an actual color.
export const READINESS_COPY: Record<ReadinessLabel, { title: string; tone: 'green' | 'neutral' | 'amber' | 'muted' }> = {
  overload_risk: { title: 'Overload risk', tone: 'amber' },
  slow_down: { title: 'Slow down', tone: 'amber' },
  on_track: { title: 'On track', tone: 'neutral' },
  ready_for_more: { title: 'Ready for more', tone: 'green' },
  insufficient_data: { title: 'Not enough data yet', tone: 'muted' },
};
