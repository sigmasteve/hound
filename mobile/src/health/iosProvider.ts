import {
  authorizationStatusFor,
  AuthorizationStatus,
  getMostRecentQuantitySample,
  isHealthDataAvailableAsync,
  queryQuantitySamples,
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
import { pickNonOverlapping } from './dedupeWorkouts';

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

// Local midnight the day after `d` — via setDate (calendar arithmetic),
// not a fixed +24h offset, so a DST transition day still lands on the
// right wall-clock midnight instead of drifting an hour.
function startOfNextDay(d: Date): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + 1);
  return next;
}

// Sums one quantity type over an explicit [startDate, endDate) instant
// range. Every "today"/per-day figure in this file goes through one of
// these two functions rather than HealthKit's own day-bucketed
// queryStatisticsCollectionForQuantity — that query's bucket boundaries
// come from a calendar HealthKit picks internally, which in practice
// lands on UTC day boundaries rather than the device's local ones unless
// the request also attaches an explicit local Calendar (this library's
// native binding never does — see QuantityTypeModule.swift's
// queryStatisticsCollectionForQuantityInternal, which builds its
// DateComponents with no `.calendar` set). For anyone not in UTC that
// silently shifted every multi-day bucket by the device's UTC offset,
// which is exactly why Home's "today" steps tile (a single explicit-
// range query) and Metrics' weekly chart (previously the bucketed
// query's last entry) could disagree about the same device's own
// "today." Querying one exact range per day costs nothing at this scale
// (getDailyStepsSince is capped at 30 days by CreateScreen) and
// guarantees every day lines up with the same local midnight getSnapshot
// already used.
async function stepsSum(startDate: Date, endDate: Date): Promise<number> {
  const stats = await orDefault(
    queryStatisticsForQuantity('HKQuantityTypeIdentifierStepCount', ['cumulativeSum'], {
      filter: { date: { startDate, endDate } },
      unit: 'count',
    }),
    { sources: [] },
  );
  return stats.sumQuantity?.quantity ?? 0;
}

async function distanceSumMi(startDate: Date, endDate: Date): Promise<number> {
  const stats = await orDefault(
    queryStatisticsForQuantity('HKQuantityTypeIdentifierDistanceWalkingRunning', ['cumulativeSum'], {
      filter: { date: { startDate, endDate } },
      unit: 'mi',
    }),
    { sources: [] },
  );
  return stats.sumQuantity?.quantity ?? 0;
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
    //
    // Guarded the same way androidProvider.ts's own version now is —
    // this is the one call RootNavigator's connect gate awaits on every
    // fresh sign-in with no catch of its own, so a throw here (e.g.
    // HealthKit genuinely unavailable) would leave that gate stuck on
    // 'checking' forever instead of just treating it as unavailable.
    try {
      const status = authorizationStatusFor('HKQuantityTypeIdentifierStepCount');
      return status === AuthorizationStatus.notDetermined ? 'not-determined' : 'authorized';
    } catch {
      return 'unavailable';
    }
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

    const [stepsToday, distanceTodayMi, restingHr, weight] = await Promise.all([
      stepsSum(todayStart, now),
      distanceSumMi(todayStart, now),
      orDefault(getMostRecentQuantitySample('HKQuantityTypeIdentifierRestingHeartRate', 'count/min'), undefined),
      orDefault(getMostRecentQuantitySample('HKQuantityTypeIdentifierBodyMass', 'lb'), undefined),
    ]);

    return {
      stepsToday: Math.round(stepsToday),
      stepsGoal: 10000,
      distanceTodayMi: Math.round(distanceTodayMi * 10) / 10,
      restingHeartRateBpm: restingHr ? Math.round(restingHr.quantity) : null,
      latestWeightLb: weight ? Math.round(weight.quantity * 10) / 10 : null,
      source: 'Apple Health',
      lastSyncedAt: new Date(),
    };
  },

  async getWeeklySteps(): Promise<DailySteps[]> {
    const now = new Date();
    const today = startOfDay(now);
    const days: Date[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      days.push(d);
    }

    const totals = await Promise.all(
      days.map((dayStart) => stepsSum(dayStart, dayStart.getTime() === today.getTime() ? now : startOfNextDay(dayStart))),
    );

    return days.map((d, i) => ({
      date: d.toLocaleDateString(undefined, { weekday: 'short' }),
      steps: Math.round(totals[i]),
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
    const rawWorkouts = await orDefault(queryWorkoutSamples({ limit, ascending: false }), []);
    // See dedupeWorkouts.ts's own comment — a Watch + companion-app pair
    // both writing the same session shows up here as two HKWorkout
    // records with the same activity type and overlapping start/end.
    const workouts = pickNonOverlapping(rawWorkouts, (w) => ({
      activityKey: String(w.workoutActivityType),
      startMs: w.startDate.getTime(),
      endMs: w.endDate.getTime(),
      richness: (w.totalDistance?.quantity ? 1 : 0) + (w.totalEnergyBurned?.quantity ? 1 : 0),
    }));
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
          // HKIndoorWorkout is only present when whatever logged the
          // workout actually recorded it (the Workout app does; a lot of
          // third-party apps and manual entries don't) — absent means
          // "unknown", not "outdoor", so this has to stay undefined rather
          // than defaulting to a guess; deviceSync.ts's name heuristic is
          // the fallback for that case.
          isOutdoor: w.metadata.HKIndoorWorkout == null ? undefined : !w.metadata.HKIndoorWorkout,
          avgHeartRate: undefined,
          // w.duration is HKWorkout's own duration Quantity, always in
          // seconds (NSTimeInterval) — no unit param to request like the
          // getStatistic calls above take, since HealthKit hands this one
          // back pre-computed.
          durationMin: w.duration?.quantity != null ? Math.round(w.duration.quantity / 60) : undefined,
        };
      }),
    );
  },

  async getDailyStepsSince(since: Date): Promise<DailyStepsWithDate[]> {
    const now = new Date();
    const today = startOfDay(now);
    const start = startOfDay(since);

    const days: Date[] = [];
    for (const cursor = new Date(start); cursor.getTime() <= today.getTime(); cursor.setDate(cursor.getDate() + 1)) {
      days.push(new Date(cursor));
    }

    return Promise.all(
      days.map(async (dayStart) => {
        const dayEnd = dayStart.getTime() === today.getTime() ? now : startOfNextDay(dayStart);
        const [steps, distanceMi] = await Promise.all([stepsSum(dayStart, dayEnd), distanceSumMi(dayStart, dayEnd)]);
        return {
          date: dateKey(dayStart),
          steps: Math.round(steps),
          distanceMi: Math.round(distanceMi * 10) / 10,
        };
      }),
    );
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
