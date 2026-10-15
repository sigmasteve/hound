import { useEffect, useState } from 'react';
import { useHealthProvider } from '../health/HealthContext';
import type { DailyStepsWithDate, WorkoutSample } from '../health/types';

export interface GoalHistory {
  days: DailyStepsWithDate[];
  workouts: WorkoutSample[];
}

// The last four weeks of steps, distance and workouts, for "you
// average…" suggestions. Null while loading; empty if the phone has none.
export function useGoalHistory(): GoalHistory | null {
  const health = useHealthProvider();
  const [history, setHistory] = useState<GoalHistory | null>(null);
  useEffect(() => {
    const since = new Date();
    since.setDate(since.getDate() - 29);
    let cancelled = false;
    Promise.all([health.getDailyStepsSince(since), health.getRecentWorkouts(200)])
      .then(([days, workouts]) => {
        if (!cancelled) setHistory({ days, workouts });
      })
      .catch(() => {
        if (!cancelled) setHistory({ days: [], workouts: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [health]);
  return history;
}
