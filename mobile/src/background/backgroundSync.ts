import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { supabase } from '../lib/supabase';
import { resolveHealthProvider } from '../health';
import { supabaseChallengesProvider } from '../challenges/supabaseChallenges';
import {
  isWorthSyncing,
  sharedHealthReads,
  syncBingoProgressFromDevice,
  syncChallengeProgressFromDevice,
  syncSeventyFiveFromDevice,
} from '../challenges/deviceSync';
import { recordDailyStepTotal } from '../leaderboard/supabaseStepsRank';
import { getHoundSettings, listGoals } from '../goals/goalsApi';
import { goalProgress, weekStart } from '../goals/goals';
import { claimGoalDay, claimGoalWeek, getGoalStreak, goalsEarned } from '../goals/goalStreakApi';
import { refreshHoundNow } from '../goals/hound';
import { updateWidgets } from '../widgets/widgetData';
import { numbersFromProgress } from '../widgets/widgetModel';
import { syncJourney } from '../journeys/journeySync';

// Background sync (from 0.10.2, the first build with the native module):
// every so often, even with Hound closed, the phone wakes the app to
//   - read today's steps, distance and workouts,
//   - bring every running challenge up to date (the same sync Today does
//     on open, deviceSync.ts),
//   - claim the Bones for a goal day or week that's just been done, so a
//     streak doesn't break because Hound wasn't opened that day,
//   - reschedule the Hound's reminders with fresh numbers, so it stops
//     reminding you about a goal you've already hit,
//   - and (from 0.11.0) update the home screen widgets.
//
// The phone decides when: at least every 30 minutes is what we ask for,
// but iOS in particular runs it when it suits the battery, often less.
// Imported once in index.ts (the task has to be defined before the app
// starts), and registered from Main once someone is signed in.

const TASK_NAME = 'hound-background-sync';
const MINIMUM_INTERVAL_MIN = 30;

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
  // When the phone can't read its health data (locked, or no background
  // access), every read comes back as 0 steps. Syncing that would put 0
  // on the leaderboards (0115_keep_synced_steps.sql) and the widgets, so
  // leave it to the next run.
  if (health.canReadNow && !(await health.canReadNow())) return;

  const [snap, workouts] = await Promise.all([health.getSnapshot(), health.getRecentWorkouts(50)]);
  await recordDailyStepTotal(userId, snap.stepsToday).catch(() => {});

  // Running challenges, plus ones that just ended (late steps count
  // until they settle), reading the phone's health data once for all.
  const challenges = (await supabaseChallengesProvider.listMyChallenges().catch(() => [])).filter((c) =>
    isWorthSyncing(c),
  );
  const shared = sharedHealthReads(health, challenges);
  for (const c of challenges) {
    await Promise.all([
      syncChallengeProgressFromDevice(c, shared),
      syncBingoProgressFromDevice(c, shared),
      syncSeventyFiveFromDevice(c, shared),
    ]);
  }

  // Your Journey's miles, and a notification when you pass a stop.
  await syncJourney(userId, health);

  const [goals, settings] = await Promise.all([listGoals(userId), getHoundSettings(userId)]);
  const needsWeek = goals.some((g) => g.period === 'week' && (g.metric === 'steps' || g.metric === 'distance_mi'));
  // A week the phone couldn't read would show weekly goals at zero on the
  // widget; leave the widget as it was instead.
  let weekRead = true;
  const weekDays = needsWeek
    ? await health.getDailyStepsSince(weekStart()).catch(() => {
        weekRead = false;
        return [];
      })
    : [];
  const inputs = { stepsToday: snap.stepsToday, distanceTodayMi: snap.distanceTodayMi, weekDays, workouts };
  const progress = goals.map((g) => goalProgress(g, inputs));

  // The server pays each day and week once, so asking again is harmless.
  const earned = goalsEarned(progress);
  if (earned.day) await claimGoalDay().catch(() => {});
  if (earned.week) await claimGoalWeek().catch(() => {});

  // The home screen widgets, so they keep up while Hound is closed. Your
  // hound's picture and mood stay as Today last saved them.
  if (weekRead) {
    await updateWidgets({
      ...numbersFromProgress(progress, snap.stepsToday),
      streak: await getGoalStreak().catch(() => null),
    });
  }

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
