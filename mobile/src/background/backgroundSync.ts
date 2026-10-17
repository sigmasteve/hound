import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { supabase } from '../lib/supabase';
import { resolveHealthProvider } from '../health';
import { supabaseChallengesProvider } from '../challenges/supabaseChallenges';
import {
  syncBingoProgressFromDevice,
  syncChallengeProgressFromDevice,
  syncSeventyFiveFromDevice,
} from '../challenges/deviceSync';
import { recordDailyStepTotal } from '../leaderboard/supabaseStepsRank';
import { getHoundSettings, listGoals } from '../goals/goalsApi';
import { goalProgress, weekStart } from '../goals/goals';
import { claimGoalDay, claimGoalWeek, goalsEarned } from '../goals/goalStreakApi';
import { refreshHoundNow } from '../goals/hound';

// Background sync (from 0.10.2, the first build with the native module):
// every so often, even with Hound closed, the phone wakes the app to
//   - read today's steps, distance and workouts,
//   - bring every running challenge up to date (the same sync Today does
//     on open, deviceSync.ts),
//   - claim the Bones for a goal day or week that's just been done, so a
//     streak doesn't break because Hound wasn't opened that day,
//   - and reschedule the Hound's reminders with fresh numbers, so it stops
//     reminding you about a goal you've already hit.
//
// The phone decides when: at least every 30 minutes is what we ask for,
// but iOS in particular runs it when it suits the battery, often less.
// Imported once in index.ts (the task has to be defined before the app
// starts), and registered from Main once someone is signed in.

const TASK_NAME = 'hound-background-sync';
const MINIMUM_INTERVAL_MIN = 30;
const DAY_MS = 86_400_000;

TaskManager.defineTask(TASK_NAME, async () => {
  try {
    await syncNow();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

async function syncNow(): Promise<void> {
  if (!supabase) return;
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return;

  const health = await resolveHealthProvider();
  // Sample data isn't real activity: nothing to sync.
  if (health.platform === 'mock') return;

  const [snap, workouts] = await Promise.all([health.getSnapshot(), health.getRecentWorkouts(50)]);
  await recordDailyStepTotal(userId, snap.stepsToday).catch(() => {});

  // Running challenges, plus ones that ended in the last day (their last
  // day can still be filling in).
  const challenges = await supabaseChallengesProvider.listMyChallenges().catch(() => []);
  const now = Date.now();
  for (const c of challenges.filter((c) => new Date(c.endsAt).getTime() > now - DAY_MS)) {
    await Promise.all([
      syncChallengeProgressFromDevice(c, health),
      syncBingoProgressFromDevice(c, health),
      syncSeventyFiveFromDevice(c, health),
    ]);
  }

  const [goals, settings] = await Promise.all([listGoals(userId), getHoundSettings(userId)]);
  const needsWeek = goals.some((g) => g.period === 'week' && (g.metric === 'steps' || g.metric === 'distance_mi'));
  const weekDays = needsWeek ? await health.getDailyStepsSince(weekStart()).catch(() => []) : [];
  const inputs = { stepsToday: snap.stepsToday, distanceTodayMi: snap.distanceTodayMi, weekDays, workouts };
  const progress = goals.map((g) => goalProgress(g, inputs));

  // The server pays each day and week once, so asking again is harmless.
  const earned = goalsEarned(progress);
  if (earned.day) await claimGoalDay().catch(() => {});
  if (earned.week) await claimGoalWeek().catch(() => {});

  await refreshHoundNow({
    userId,
    level: settings.level,
    progress,
  });
}

// Safe to call on every launch: registering again just keeps the one
// registration.
export async function registerBackgroundSync(): Promise<void> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
    if (await TaskManager.isTaskRegisteredAsync(TASK_NAME)) return;
    await BackgroundTask.registerTaskAsync(TASK_NAME, { minimumInterval: MINIMUM_INTERVAL_MIN });
  } catch {
    // Background sync is a bonus: the app works the same without it.
  }
}
