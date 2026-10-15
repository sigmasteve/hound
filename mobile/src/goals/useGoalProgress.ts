import { useEffect, useMemo, useState } from 'react';
import { useHealthProvider } from '../health/HealthContext';
import type { DailyStepsWithDate, HealthSnapshot, WorkoutSample } from '../health/types';
import { goalProgress, weekStart, type GoalProgress } from './goals';
import { useGoals } from './GoalsContext';

// Progress on every goal, from the same health snapshot and workouts the
// screen already has. Weekly step and distance goals also need this
// week's daily history, fetched only when one of them exists.
export function useGoalProgress(snap: HealthSnapshot | null, workouts: WorkoutSample[]): GoalProgress[] | null {
  const { goals, loaded } = useGoals();
  const health = useHealthProvider();
  const [weekDays, setWeekDays] = useState<DailyStepsWithDate[]>([]);
  const needsWeek = goals.some((g) => g.period === 'week' && (g.metric === 'steps' || g.metric === 'distance_mi'));

  useEffect(() => {
    if (!needsWeek || !snap) return;
    let cancelled = false;
    health
      .getDailyStepsSince(weekStart())
      .then((days) => {
        if (!cancelled) setWeekDays(days);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [needsWeek, snap, health]);

  return useMemo(() => {
    if (!loaded || !snap) return null;
    const inputs = {
      stepsToday: snap.stepsToday,
      distanceTodayMi: snap.distanceTodayMi,
      weekDays,
      workouts,
    };
    return goals.map((g) => goalProgress(g, inputs));
  }, [loaded, snap, goals, weekDays, workouts]);
}
