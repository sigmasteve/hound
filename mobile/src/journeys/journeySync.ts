import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { classifyWorkout } from '../challenges/bingo';
import { localDayKey } from '../goals/goals';
import type { HealthProvider, WorkoutSample } from '../health/types';
import { courseById, formatMiles, nextStop, stopsPassed } from './courses';
import { checkJourneyFinish, getMyJourney, recordDailyMiles, type DailyMiles } from './journeyApi';

// Keeps Journeys moving: uploads each day's miles (0120_journeys.sql),
// lets the server mark a finish (and tell your friends), and shows a
// notification on this phone when you pass a stop along the way. Runs
// with every sync, in the app and in the background; best-effort, so it
// never throws.

const DAYS_BACK = 30;
const NOTIFIED_KEY = (journeyId: string) => `journey:notified:${journeyId}`;

// Walks, runs and hikes. Bike rides and swims don't count (yet).
function onFoot(w: WorkoutSample): boolean {
  const type = classifyWorkout(w.name, 'variety');
  return type === 'run' || type === 'walk_hike';
}

export function milesByDay(
  workouts: WorkoutSample[],
  allDay: { date: string; distanceMi: number }[],
): DailyMiles[] {
  const byDay = new Map<string, DailyMiles>();
  const row = (day: string) => {
    let r = byDay.get(day);
    if (!r) {
      r = { day, workoutMi: 0, allMi: 0 };
      byDay.set(day, r);
    }
    return r;
  };
  for (const w of workouts) {
    if (onFoot(w) && w.distanceMi) row(localDayKey(w.when)).workoutMi += w.distanceMi;
  }
  for (const d of allDay) {
    if (d.distanceMi > 0) row(d.date).allMi = d.distanceMi;
  }
  return Array.from(byDay.values());
}

export async function syncJourney(userId: string, health: HealthProvider): Promise<void> {
  // Made-up numbers (web, simulator) mustn't count toward a real course.
  if (health.platform === 'mock') return;
  try {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - DAYS_BACK);
    const [workouts, allDay] = await Promise.all([
      health.getRecentWorkouts(200).catch(() => []),
      health.getDailyStepsSince(since).catch(() => []),
    ]);
    await recordDailyMiles(userId, milesByDay(workouts, allDay));

    const journey = await getMyJourney();
    if (!journey || journey.finishedAt) return;
    const course = courseById(journey.courseId);
    const finished = await checkJourneyFinish().catch(() => false);

    // The furthest stop passed since the last notification.
    const already = Number((await AsyncStorage.getItem(NOTIFIED_KEY(journey.id)).catch(() => null)) ?? '0');
    if (finished) {
      await notify('You finished! 🏅', `You walked the whole ${journey.courseName}. ${formatMiles(journey.courseMiles)} miles.`);
      await AsyncStorage.setItem(NOTIFIED_KEY(journey.id), String(journey.courseMiles)).catch(() => {});
      return;
    }
    if (!course) return;
    const passed = stopsPassed(course, journey.miles).filter((s) => s.mi > already && s.mi < course.miles);
    const latest = passed[passed.length - 1];
    if (!latest) return;
    const next = nextStop(course, journey.miles);
    const left = Math.max(0, course.miles - journey.miles);
    await notify(
      `You passed ${latest.name}`,
      `Mile ${formatMiles(latest.mi)} on the ${course.name}.${next ? ` Next: ${next.name}.` : ''} ${formatMiles(left)} to go.`,
    );
    await AsyncStorage.setItem(NOTIFIED_KEY(journey.id), String(latest.mi)).catch(() => {});
  } catch {
    // Best-effort: the next sync tries again.
  }
}

async function notify(title: string, body: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: 'default', data: { kind: 'journey' } },
      trigger: null,
    });
  } catch {
    // A notification that can't show isn't worth failing the sync over.
  }
}
