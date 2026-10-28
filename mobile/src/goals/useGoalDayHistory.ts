import { useEffect, useState } from 'react';
import { useHealthProvider } from '../health/HealthContext';
import type { DailyStepsWithDate, HealthSnapshot, WorkoutSample } from '../health/types';
import { isSupabaseConfigured } from '../lib/supabase';
import { getShieldUsedOn } from './goalStreakApi';
import { weekStart } from './goals';

// How far back the Goals sheet looks: this week and the three before.
export const HISTORY_WEEKS = 4;

export interface GoalDayHistory {
  // The Monday the history starts on.
  since: Date;
  days: DailyStepsWithDate[];
  workouts: WorkoutSample[];
  // The day the last Streak Shield covered, if any.
  shieldDay: string | null;
}

export function historyStart(now: Date = new Date()): Date {
  const monday = weekStart(now);
  monday.setDate(monday.getDate() - 7 * (HISTORY_WEEKS - 1));
  return monday;
}

// The raw material for the goal history (goals.ts, goalDaySummary and
// goalWeekProgress): four weeks of per-day steps and distance, the
// workouts in them, and the shield day. Fetched again after each sync
// (a new snapshot), only while `enabled` (the sheet is open and there is
// a goal to score). Null until it loads.
export function useGoalDayHistory(snap: HealthSnapshot | null, enabled: boolean): GoalDayHistory | null {
  const health = useHealthProvider();
  const [history, setHistory] = useState<GoalDayHistory | null>(null);

  useEffect(() => {
    if (!enabled || !snap) return;
    let cancelled = false;
    const since = historyStart();
    // A week more than the grid shows: the week strip can sit up to three
    // days before the grid's first Monday when centred on a day near it.
    const fetchSince = new Date(since.getFullYear(), since.getMonth(), since.getDate() - 7);
    const shield: Promise<string | null> = isSupabaseConfigured ? getShieldUsedOn().catch(() => null) : Promise.resolve(null);
    Promise.all([health.getDailyStepsSince(fetchSince), health.getRecentWorkouts(300), shield])
      .then(([days, workouts, shieldDay]) => {
        if (!cancelled) setHistory({ since, days, workouts, shieldDay });
      })
      .catch(() => {
        if (!cancelled) setHistory({ since, days: [], workouts: [], shieldDay: null });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, snap, health]);

  return enabled ? history : null;
}
