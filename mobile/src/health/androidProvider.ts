import {
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  readRecords,
  requestPermission,
} from 'react-native-health-connect';
import type {
  DailySteps,
  DailyStepsWithDate,
  HealthAuthStatus,
  HealthProvider,
  HealthSnapshot,
  WorkoutSample,
} from './types';

// Real Health Connect integration. Requires a custom dev client or a
// standalone build (`npx expo prebuild` + `expo run:android`, or an EAS
// dev-client build) — Health Connect is a native module and is NOT
// available in Expo Go. Also needs the `android.permission.health.READ_*`
// entries in app.json's `android.permissions` and the Health Connect app
// installed on the test device/emulator (Android 14+ ships it in-box;
// earlier versions install it from Play).

const PERMISSIONS = [
  { accessType: 'read' as const, recordType: 'Steps' as const },
  { accessType: 'read' as const, recordType: 'Distance' as const },
  { accessType: 'read' as const, recordType: 'HeartRate' as const },
  { accessType: 'read' as const, recordType: 'Weight' as const },
  { accessType: 'read' as const, recordType: 'ExerciseSession' as const },
];

let initialized = false;
async function ensureInitialized(): Promise<boolean> {
  if (initialized) return true;
  initialized = await initialize();
  return initialized;
}

function metersToMiles(m: number): number {
  return m / 1609.344;
}
function kgToLb(kg: number): number {
  return kg * 2.20462;
}
function startOfDayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// readRecords throws if the permission for that record type hasn't been
// granted yet — an expected state (screens query data as soon as they
// mount, before the user necessarily visited the Connect screen), not a
// bug to crash over. Every read below falls back to an empty result
// instead of rejecting.
function orEmpty<T>(promise: Promise<{ records: T[] }>): Promise<{ records: T[] }> {
  return promise.catch(() => ({ records: [] as T[] }));
}

export const androidHealthProvider: HealthProvider = {
  platform: 'android',
  platformLabel: 'Health Connect',

  async isAvailable(): Promise<boolean> {
    // 3 === SDK_AVAILABLE in the native enum; a non-throwing call this
    // early also confirms the native module actually linked.
    try {
      const status = await getSdkStatus();
      return status === 3;
    } catch {
      return false;
    }
  },

  async getAuthorizationStatus(): Promise<HealthAuthStatus> {
    if (!(await ensureInitialized())) return 'unavailable';
    const granted = await getGrantedPermissions();
    const haveAll = PERMISSIONS.every((p) =>
      granted.some((g) => 'recordType' in g && g.recordType === p.recordType),
    );
    return haveAll ? 'authorized' : 'not-determined';
  },

  async requestAuthorization(): Promise<HealthAuthStatus> {
    if (!(await ensureInitialized())) return 'unavailable';
    const granted = await requestPermission(PERMISSIONS);
    const haveAll = PERMISSIONS.every((p) =>
      granted.some((g) => 'recordType' in g && g.recordType === p.recordType),
    );
    return haveAll ? 'authorized' : 'denied';
  },

  async getSnapshot(): Promise<HealthSnapshot> {
    await ensureInitialized();
    const todayFilter = { operator: 'between' as const, startTime: startOfDayIso(), endTime: new Date().toISOString() };

    const [steps, distance, heartRate, weight] = await Promise.all([
      orEmpty(readRecords('Steps', { timeRangeFilter: todayFilter })),
      orEmpty(readRecords('Distance', { timeRangeFilter: todayFilter })),
      orEmpty(readRecords('HeartRate', { timeRangeFilter: todayFilter })),
      orEmpty(readRecords('Weight', { timeRangeFilter: { operator: 'before', endTime: new Date().toISOString() } })),
    ]);

    const totalSteps = steps.records.reduce((sum, r) => sum + r.count, 0);
    const totalDistanceMi = distance.records.reduce((sum, r) => sum + metersToMiles(r.distance.inMeters), 0);
    const restingSamples = heartRate.records.flatMap((r) => r.samples.map((s) => s.beatsPerMinute));
    const latestWeightKg = weight.records.at(-1)?.weight.inKilograms;

    return {
      stepsToday: Math.round(totalSteps),
      stepsGoal: 10000,
      distanceTodayMi: Math.round(totalDistanceMi * 10) / 10,
      restingHeartRateBpm: restingSamples.length
        ? Math.round(restingSamples.reduce((a, b) => a + b, 0) / restingSamples.length)
        : null,
      latestWeightLb: latestWeightKg != null ? Math.round(kgToLb(latestWeightKg) * 10) / 10 : null,
      source: 'Health Connect',
      lastSyncedAt: new Date(),
    };
  },

  async getWeeklySteps(): Promise<DailySteps[]> {
    await ensureInitialized();
    const out: DailySteps[] = [];
    for (let i = 6; i >= 0; i--) {
      const start = daysAgoIso(i);
      const endDate = new Date(start);
      endDate.setDate(endDate.getDate() + 1);
      const { records } = await orEmpty(readRecords('Steps', {
        timeRangeFilter: { operator: 'between', startTime: start, endTime: endDate.toISOString() },
      }));
      const total = records.reduce((sum, r) => sum + r.count, 0);
      out.push({
        date: new Date(start).toLocaleDateString(undefined, { weekday: 'short' }),
        steps: Math.round(total),
      });
    }
    return out;
  },

  async getHeartRateSeries(days: number): Promise<number[]> {
    await ensureInitialized();
    const { records } = await orEmpty(readRecords('HeartRate', {
      timeRangeFilter: { operator: 'between', startTime: daysAgoIso(days - 1), endTime: new Date().toISOString() },
    }));
    return records.flatMap((r) => r.samples.map((s) => s.beatsPerMinute));
  },

  async getWeightSeries(days: number): Promise<number[]> {
    await ensureInitialized();
    const { records } = await orEmpty(readRecords('Weight', {
      timeRangeFilter: { operator: 'between', startTime: daysAgoIso(days - 1), endTime: new Date().toISOString() },
    }));
    return records.map((r) => Math.round(kgToLb(r.weight.inKilograms) * 10) / 10);
  },

  async getRecentWorkouts(limit: number): Promise<WorkoutSample[]> {
    await ensureInitialized();
    const { records } = await orEmpty(readRecords('ExerciseSession', {
      timeRangeFilter: { operator: 'between', startTime: daysAgoIso(30), endTime: new Date().toISOString() },
      ascendingOrder: false,
      pageSize: limit,
    }));
    const sessions = records.slice(0, limit);
    // ExerciseSession has no distance of its own (unlike HealthKit's
    // HKWorkout, which carries its own distance statistic) — Health
    // Connect keeps distance as a separate record type, so a workout's
    // distance is whatever 'Distance' records fall inside its own
    // [startTime, endTime] window, same idea as iosProvider's per-workout
    // getStatistic call just against a different API shape.
    return Promise.all(
      sessions.map(async (r, i) => {
        const { records: distanceRecords } = await orEmpty(readRecords('Distance', {
          timeRangeFilter: { operator: 'between', startTime: r.startTime, endTime: r.endTime },
        }));
        const distanceMi = distanceRecords.reduce((sum, d) => sum + metersToMiles(d.distance.inMeters), 0);
        return {
          id: r.metadata?.id ?? String(i),
          name: r.title ?? r.exerciseType?.toString() ?? 'Workout',
          when: new Date(r.startTime),
          source: 'Health Connect',
          distanceMi: distanceMi > 0 ? Math.round(distanceMi * 10) / 10 : undefined,
          // ExerciseSession carries its own [startTime, endTime] window
          // (unlike distance, there's no separate duration record type to
          // read here) — same reasoning as the distance lookup above, just
          // arithmetic instead of a second query.
          durationMin: Math.round((new Date(r.endTime).getTime() - new Date(r.startTime).getTime()) / 60_000),
        };
      }),
    );
  },

  async getDailyStepsSince(since: Date): Promise<DailyStepsWithDate[]> {
    await ensureInitialized();
    const start = dateOnly(since);
    const today = dateOnly(new Date());
    const out: DailyStepsWithDate[] = [];

    for (let cursor = start; cursor.getTime() <= today.getTime(); cursor.setDate(cursor.getDate() + 1)) {
      const dayStart = cursor.toISOString();
      const dayEnd = new Date(cursor);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const filter = { operator: 'between' as const, startTime: dayStart, endTime: dayEnd.toISOString() };

      const [steps, distance] = await Promise.all([
        orEmpty(readRecords('Steps', { timeRangeFilter: filter })),
        orEmpty(readRecords('Distance', { timeRangeFilter: filter })),
      ]);
      const totalSteps = steps.records.reduce((sum, r) => sum + r.count, 0);
      const totalDistanceMi = distance.records.reduce((sum, r) => sum + metersToMiles(r.distance.inMeters), 0);

      out.push({
        date: dateKey(cursor),
        steps: Math.round(totalSteps),
        distanceMi: Math.round(totalDistanceMi * 10) / 10,
      });
    }
    return out;
  },
};

function dateOnly(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
