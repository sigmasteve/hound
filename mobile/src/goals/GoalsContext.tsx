import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Per-device, same as the theme preference — goals only drive Home's own
// progress tiles, so there's nothing server-side that needs to read them.
const STORAGE_KEY = 'hound:daily-goals';

export const DEFAULT_STEPS_GOAL = 10_000;
export const DEFAULT_DISTANCE_GOAL_MI = 3;

interface DailyGoals {
  stepsGoal: number;
  distanceGoalMi: number;
}

interface GoalsContextValue extends DailyGoals {
  setStepsGoal: (steps: number) => void;
  setDistanceGoalMi: (miles: number) => void;
}

const GoalsReactContext = createContext<GoalsContextValue | null>(null);

export function GoalsProvider({ children }: { children: React.ReactNode }) {
  const [goals, setGoals] = useState<DailyGoals>({
    stepsGoal: DEFAULT_STEPS_GOAL,
    distanceGoalMi: DEFAULT_DISTANCE_GOAL_MI,
  });

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (!saved) return;
        const parsed = JSON.parse(saved) as Partial<DailyGoals>;
        setGoals((cur) => ({
          stepsGoal: typeof parsed.stepsGoal === 'number' && parsed.stepsGoal > 0 ? parsed.stepsGoal : cur.stepsGoal,
          distanceGoalMi:
            typeof parsed.distanceGoalMi === 'number' && parsed.distanceGoalMi > 0
              ? parsed.distanceGoalMi
              : cur.distanceGoalMi,
        }));
      })
      .catch(() => {
        // Nothing stored, unreadable, or storage unavailable — keep defaults.
      });
  }, []);

  const update = useCallback((patch: Partial<DailyGoals>) => {
    setGoals((cur) => {
      const next = { ...cur, ...patch };
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {
        // Best-effort — the new goal still applies for this session.
      });
      return next;
    });
  }, []);

  const setStepsGoal = useCallback((stepsGoal: number) => update({ stepsGoal }), [update]);
  const setDistanceGoalMi = useCallback((distanceGoalMi: number) => update({ distanceGoalMi }), [update]);

  const value = useMemo<GoalsContextValue>(
    () => ({ ...goals, setStepsGoal, setDistanceGoalMi }),
    [goals, setStepsGoal, setDistanceGoalMi],
  );

  return <GoalsReactContext.Provider value={value}>{children}</GoalsReactContext.Provider>;
}

export function useGoals(): GoalsContextValue {
  const ctx = useContext(GoalsReactContext);
  if (!ctx) throw new Error('useGoals() must be called within a GoalsProvider');
  return ctx;
}
