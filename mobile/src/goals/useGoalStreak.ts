import { useCallback, useEffect, useRef, useState } from 'react';
import { isSupabaseConfigured } from '../lib/supabase';
import { localDayKey, weekStart, type GoalProgress } from './goals';
import { claimGoalDay, claimGoalWeek, getGoalStreak, goalsEarned, type GoalStreak } from './goalStreakApi';
import { updateHound } from './hound';

export type GoalAward = { kind: 'day'; bones: number; streak: number } | { kind: 'week'; bones: number };

// Today's goal streak, and the claims that pay for it: as soon as every
// daily goal is done (or every weekly one), Today asks the server for
// the Bones. Each claim is tried once per day or week while Today is
// open; the server pays it once however often it's asked.
export function useGoalStreak(
  userId: string | null | undefined,
  progress: GoalProgress[] | null,
  onAward: (award: GoalAward) => void,
  // Whether yesterday's goals were met on the phone (useYesterdayGoalsEarned):
  // null while unknown. When they were and the server never heard
  // (goals finished late with Hound closed), yesterday is claimed first,
  // so today's claim then continues the streak instead of starting over.
  yesterdayEarned: boolean | null = false,
): { streak: GoalStreak | null; refresh: () => void } {
  const [streak, setStreak] = useState<GoalStreak | null>(null);
  const tried = useRef(new Set<string>());
  const onAwardRef = useRef(onAward);
  onAwardRef.current = onAward;
  const enabled = isSupabaseConfigured && !!userId;

  const refresh = useCallback(() => {
    if (!enabled) return;
    getGoalStreak()
      .then(setStreak)
      .catch(() => {
        // The card just goes without its streak line.
      });
  }, [enabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // The Hound mentions a streak that today could still break.
  useEffect(() => {
    if (streak) updateHound({ streak: { count: streak.hitToday ? 0 : streak.streak, day: localDayKey(new Date()) } });
  }, [streak]);

  useEffect(() => {
    if (!enabled || !progress || !streak) return;
    const earned = goalsEarned(progress);
    const now = new Date();
    const dayKey = `day:${localDayKey(now)}`;
    const weekKey = `week:${localDayKey(weekStart(now))}`;

    // Yesterday isn't on the server (the streak reads 0, or only a Streak
    // Shield is holding it) but the phone says it was earned: claim it
    // before today, since a claim for today would close the door on it.
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = localDayKey(yesterday);
    const gap = !streak.hitToday && (streak.streak === 0 || streak.shieldCovering);
    if (gap && yesterdayEarned === null) return;
    if (gap && yesterdayEarned && !tried.current.has(`day:${yesterdayKey}`)) {
      tried.current.add(`day:${yesterdayKey}`);
      claimGoalDay(yesterdayKey)
        .then((c) => {
          if (c.awarded) onAwardRef.current({ kind: 'day', bones: c.bonesAwarded, streak: c.streak });
          refresh();
        })
        .catch(() => {
          // The server said no (too long ago, or already covered): today's
          // claim goes ahead on the next pass.
          refresh();
        });
      return;
    }

    if (earned.day && !streak.hitToday && !tried.current.has(dayKey)) {
      tried.current.add(dayKey);
      claimGoalDay()
        .then((c) => {
          if (c.awarded) onAwardRef.current({ kind: 'day', bones: c.bonesAwarded, streak: c.streak });
          refresh();
        })
        .catch(() => tried.current.delete(dayKey));
    }
    if (earned.week && !streak.weekPaid && !tried.current.has(weekKey)) {
      tried.current.add(weekKey);
      claimGoalWeek()
        .then((c) => {
          if (c.awarded) onAwardRef.current({ kind: 'week', bones: c.bonesAwarded });
          refresh();
        })
        .catch(() => tried.current.delete(weekKey));
    }
  }, [enabled, progress, streak, refresh, yesterdayEarned]);

  return { streak, refresh };
}
