import { useEffect, useMemo, useState } from 'react';
import { useHealthProvider } from '../health/HealthContext';
import type { DailyStepsWithDate, HealthSnapshot, WorkoutSample } from '../health/types';
import { goalProgress, goalsEarnedOn, localDayKey, weekStart, type GoalProgress } from './goals';
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

// Whether every daily goal was met yesterday, from the phone's own
// per-day data. Null until known; false when the phone can't say. Feeds
// the catch-up claim in useGoalStreak and holds back the "Oh snap" card
// (useCelebrations) while a claim is on its way.
export function useYesterdayGoalsEarned(snap: HealthSnapshot | null, workouts: WorkoutSample[]): boolean | null {
  const { goals, loaded } = useGoals();
  const health = useHealthProvider();
  const [days, setDays] = useState<DailyStepsWithDate[] | null>(null);
  const hasDaily = goals.some((g) => g.period === 'day');

  useEffect(() => {
    if (!hasDaily || !snap) return;
    let cancelled = false;
    const since = new Date();
    since.setDate(since.getDate() - 1);
    since.setHours(0, 0, 0, 0);
    health
      .getDailyStepsSince(since)
      .then((d) => {
        if (!cancelled) setDays(d);
      })
      .catch(() => {
        if (!cancelled) setDays([]);
      });
    return () => {
      cancelled = true;
    };
  }, [hasDaily, snap, health]);

  return useMemo(() => {
    if (!loaded || !snap) return null;
    if (!hasDaily) return false;
    if (days === null) return null;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return goalsEarnedOn(goals, localDayKey(yesterday), days, workouts) ?? false;
  }, [loaded, snap, hasDaily, days, goals, workouts]);
}
