import {
  authorizationStatusFor,
  AuthorizationStatus,
  getMostRecentQuantitySample,
  isHealthDataAvailableAsync,
  queryQuantitySamples,
  queryStatisticsCollectionForQuantity,
  queryStatisticsForQuantity,
  queryWorkoutSamples,
  requestAuthorization,
  WorkoutActivityType,
} from '@kingstinct/react-native-healthkit';
import type {
  DailySteps,
  DailyStepsWithDate,
  HealthAuthStatus,
  HealthProvider,
  HealthSnapshot,
  WorkoutSample,
} from './types';

// Real HealthKit integration via @kingstinct/react-native-healthkit (a Nitro
// Module — React Native's New Architecture only). Requires a custom dev
// client or a standalone build (`npx expo prebuild` + `expo run:ios`, or an
// EAS dev-client build) — HealthKit is a native module and is NOT available
// in Expo Go.
//
// This project previously used `react-native-health`, a legacy (non-Turbo)
// native module. As of React Native 0.82, Old Architecture support has been
// removed from React Native's own Podfile tooling entirely (see
// `react_native_pods.rb`'s `warn_if_new_arch_disabled` — pod install always
// forces `RCT_NEW_ARCH_ENABLED=1` now, so `newArchEnabled: false` in
// app.json is a no-op on current React Native). `react-native-health` never
// registered its native module with the JS bridge under bridgeless mode
// (every call — starting with `isAvailable()` — threw `TypeError: undefined
// is not a function`), and its last release (1.19.0) predates any fix.
// Switching to a Nitro-based library sidesteps the whole legacy-bridge
// interop problem instead of patching around it.

const READ_TYPES = [
  'HKQuantityTypeIdentifierStepCount',
  'HKQuantityTypeIdentifierDistanceWalkingRunning',
  'HKQuantityTypeIdentifierHeartRate',
  'HKQuantityTypeIdentifierRestingHeartRate',
  'HKQuantityTypeIdentifierBodyMass',
  'HKWorkoutTypeIdentifier',
] as const;

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

// HealthKit throws (`Error Domain=com.apple.healthkit Code=5 "Authorization
// not determined"`) if a read is attempted before requestAuthorization has
// ever been called for that type — which happens routinely here, since
// screens query data as soon as they mount, before the user has necessarily
// visited the Connect screen. That's an expected, non-exceptional state
// (equivalent to "no data yet"), not a bug to crash over, so every read
// below is wrapped to fall back to a safe default instead of rejecting.
function orDefault<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return promise.catch(() => fallback);
}

export const iosHealthProvider: HealthProvider = {
  platform: 'ios',
  platformLabel: 'Apple Health',

  async isAvailable(): Promise<boolean> {
    return isHealthDataAvailableAsync();
  },

  async getAuthorizationStatus(): Promise<HealthAuthStatus> {
    // Apple's read-authorization status is deliberately unreliable by
    // design (HealthKit never tells an app whether a *read* permission was
    // granted or denied, only whether a request was ever made) — treat
    // "not determined" as the only meaningful distinct status and
    // everything else as authorized, matching requestAuthorization below.
    const status = authorizationStatusFor('HKQuantityTypeIdentifierStepCount');
    return status === AuthorizationStatus.notDetermined ? 'not-determined' : 'authorized';
  },

  async requestAuthorization(): Promise<HealthAuthStatus> {
    try {
      await requestAuthorization({ toRead: READ_TYPES, toShare: [] });
      return 'authorized';
    } catch {
      return 'denied';
    }
  },

  async getSnapshot(): Promise<HealthSnapshot> {
    const todayStart = startOfDay(new Date());
    const now = new Date();

    const [stepsStats, distanceStats, restingHr, weight] = await Promise.all([
      orDefault(
        queryStatisticsForQuantity(
          'HKQuantityTypeIdentifierStepCount',
          ['cumulativeSum'],
          { filter: { date: { startDate: todayStart, endDate: now } }, unit: 'count' },
        ),
        { sources: [] },
      ),
      orDefault(
        queryStatisticsForQuantity(
          'HKQuantityTypeIdentifierDistanceWalkingRunning',
          ['cumulativeSum'],
          { filter: { date: { startDate: todayStart, endDate: now } }, unit: 'mi' },
        ),
        { sources: [] },
      ),
      orDefault(getMostRecentQuantitySample('HKQuantityTypeIdentifierRestingHeartRate', 'count/min'), undefined),
      orDefault(getMostRecentQuantitySample('HKQuantityTypeIdentifierBodyMass', 'lb'), undefined),
    ]);

    return {
      stepsToday: Math.round(stepsStats.sumQuantity?.quantity ?? 0),
      stepsGoal: 10000,
      distanceTodayMi: Math.round((distanceStats.sumQuantity?.quantity ?? 0) * 10) / 10,
      restingHeartRateBpm: restingHr ? Math.round(restingHr.quantity) : null,
      latestWeightLb: weight ? Math.round(weight.quantity * 10) / 10 : null,
      source: 'Apple Health',
      lastSyncedAt: new Date(),
    };
  },

  async getWeeklySteps(): Promise<DailySteps[]> {
    const endDate = new Date();
    const startDate = startOfDay(new Date());
    startDate.setDate(startDate.getDate() - 6);

    const buckets = await orDefault(
      queryStatisticsCollectionForQuantity(
        'HKQuantityTypeIdentifierStepCount',
        ['cumulativeSum'],
        startDate,
        { day: 1 },
        { filter: { date: { startDate, endDate } }, unit: 'count' },
      ),
      [],
    );

    return buckets.map((b) => ({
      date: (b.startDate ?? startDate).toLocaleDateString(undefined, { weekday: 'short' }),
      steps: Math.round(b.sumQuantity?.quantity ?? 0),
    }));
  },

  async getHeartRateSeries(days: number): Promise<number[]> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (days - 1));

    const samples = await orDefault(
      queryQuantitySamples('HKQuantityTypeIdentifierRestingHeartRate', {
        limit: 0,
        ascending: true,
        unit: 'count/min',
        filter: { date: { startDate, endDate } },
      }),
      [],
    );
    return samples.map((s) => s.quantity);
  },

  async getWeightSeries(days: number): Promise<number[]> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (days - 1));

    const samples = await orDefault(
      queryQuantitySamples('HKQuantityTypeIdentifierBodyMass', {
        limit: 0,
        ascending: true,
        unit: 'lb',
        filter: { date: { startDate, endDate } },
      }),
      [],
    );
    return samples.map((s) => s.quantity);
  },

  async getRecentWorkouts(limit: number): Promise<WorkoutSample[]> {
    const workouts = await orDefault(queryWorkoutSamples({ limit, ascending: false }), []);
    return Promise.all(
      workouts.map(async (w) => {
        const distanceStat = await orDefault(
          w.getStatistic('HKQuantityTypeIdentifierDistanceWalkingRunning', 'mi'),
          undefined,
        );
        return {
          id: w.uuid,
          name: workoutActivityName(w.workoutActivityType),
          when: w.startDate,
          source: 'Apple Health',
          distanceMi: distanceStat?.sumQuantity?.quantity,
          avgHeartRate: undefined,
        };
      }),
    );
  },

  async getDailyStepsSince(since: Date): Promise<DailyStepsWithDate[]> {
    const endDate = new Date();
    const startDate = startOfDay(since);

    const [stepBuckets, distanceBuckets] = await Promise.all([
      orDefault(
        queryStatisticsCollectionForQuantity(
          'HKQuantityTypeIdentifierStepCount',
          ['cumulativeSum'],
          startDate,
          { day: 1 },
          { filter: { date: { startDate, endDate } }, unit: 'count' },
        ),
        [],
      ),
      orDefault(
        queryStatisticsCollectionForQuantity(
          'HKQuantityTypeIdentifierDistanceWalkingRunning',
          ['cumulativeSum'],
          startDate,
          { day: 1 },
          { filter: { date: { startDate, endDate } }, unit: 'mi' },
        ),
        [],
      ),
    ]);

    const distanceByDate = new Map<string, number>();
    for (const b of distanceBuckets) {
      distanceByDate.set(dateKey(b.startDate ?? startDate), b.sumQuantity?.quantity ?? 0);
    }

    return stepBuckets.map((b) => {
      const date = dateKey(b.startDate ?? startDate);
      return {
        date,
        steps: Math.round(b.sumQuantity?.quantity ?? 0),
        distanceMi: Math.round((distanceByDate.get(date) ?? 0) * 10) / 10,
      };
    });
  },
};

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function workoutActivityName(type: WorkoutActivityType): string {
  // WorkoutActivityType is a numeric enum; reverse lookup gives back its
  // already-display-ready camelCase key ("crossTraining",
  // "traditionalStrengthTraining", …) — title-case it for display.
  const key = WorkoutActivityType[type];
  if (!key) return 'Workout';
  return key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1').trim();
}
