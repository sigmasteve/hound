// The shape every screen reads from — platform-agnostic. Screens never
// import @kingstinct/react-native-healthkit or react-native-health-connect
// directly; they go through `useHealth()` / `getHealthProvider()` from
// ./index.ts.

export type SourceLabel = string; // e.g. "Apple Health · iPhone 15", "Health Connect · Pixel 8"

export interface DailySteps {
  date: string; // 'YYYY-MM-DD'
  steps: number;
}

// Unlike DailySteps (whose `date` is actually a weekday label like "Wed" —
// it's built for the Metrics screen's 7-day chart, not real dates), this
// carries a real ISO 'YYYY-MM-DD' per entry plus that day's distance. Used
// to backfill a challenge's progress across days the app wasn't open to
// sync (joining one that started in the past, or missing a few days), not
// for display.
export interface DailyStepsWithDate {
  date: string;
  steps: number;
  distanceMi: number;
}

export interface WorkoutSample {
  id: string;
  name: string;
  when: Date;
  source: SourceLabel;
  distanceMi?: number;
  avgHeartRate?: number;
  // Minutes, not a Quantity/unit pair like the platforms' own duration
  // fields — src/health/readiness.ts (training-load calculation) is the
  // one thing that needs this, and it only ever wants a plain number to
  // sum. Undefined for a workout whose duration couldn't be read, same
  // "missing means missing, not zero" convention distanceMi/avgHeartRate
  // already use.
  durationMin?: number;
}

export interface HealthSnapshot {
  stepsToday: number;
  stepsGoal: number;
  distanceTodayMi: number;
  restingHeartRateBpm: number | null;
  latestWeightLb: number | null;
  source: SourceLabel;
  lastSyncedAt: Date | null;
}

export type HealthAuthStatus = 'unavailable' | 'not-determined' | 'denied' | 'authorized';

export interface HealthProvider {
  readonly platform: 'ios' | 'android' | 'mock';
  readonly platformLabel: string; // "Apple Health" | "Health Connect" | "Sample data"

  isAvailable(): Promise<boolean>;
  getAuthorizationStatus(): Promise<HealthAuthStatus>;
  requestAuthorization(): Promise<HealthAuthStatus>;

  getSnapshot(): Promise<HealthSnapshot>;
  getWeeklySteps(): Promise<DailySteps[]>;
  getHeartRateSeries(days: number): Promise<number[]>;
  getWeightSeries(days: number): Promise<number[]>;
  getRecentWorkouts(limit: number): Promise<WorkoutSample[]>;
  // One entry per calendar day from `since` through today (inclusive) —
  // see DailyStepsWithDate. Only ever asked for a fairly small range in
  // practice (a challenge's own duration, capped at 30 days by
  // CreateScreen), not an open-ended history query.
  getDailyStepsSince(since: Date): Promise<DailyStepsWithDate[]>;
}
