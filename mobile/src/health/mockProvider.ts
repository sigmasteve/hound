import type { DailySteps, DailyStepsWithDate, HealthAuthStatus, HealthProvider, HealthSnapshot, WorkoutSample } from './types';

// Sample-data provider — used automatically whenever the platform module
// isn't linked (Expo Go, this dev sandbox, or web), so every screen has
// something real-looking to render without a device. Numbers mirror the
// original static prototype so the UI reads identically either way.
export const mockProvider: HealthProvider = {
  platform: 'mock',
  platformLabel: 'Sample data',

  async isAvailable() {
    return true;
  },
  async getAuthorizationStatus(): Promise<HealthAuthStatus> {
    return 'authorized';
  },
  async requestAuthorization(): Promise<HealthAuthStatus> {
    return 'authorized';
  },

  async getSnapshot(): Promise<HealthSnapshot> {
    return {
      stepsToday: 8432,
      distanceTodayMi: 3.8,
      restingHeartRateBpm: 58,
      latestWeightLb: 178.4,
      source: 'Apple Health',
      lastSyncedAt: new Date(Date.now() - 4 * 60 * 1000),
    };
  },

  async getWeeklySteps(): Promise<DailySteps[]> {
    const counts = [5680, 8090, 3760, 6790, 8810, 3210, 8432];
    const labels = ['Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Today'];
    return labels.map((label, i) => ({ date: label, steps: counts[i] }));
  },

  async getHeartRateSeries(): Promise<number[]> {
    return [62, 61, 59, 60, 58, 57, 58];
  },

  async getWeightSeries(): Promise<number[]> {
    return [181, 180.6, 180.1, 179.4, 179.2, 178.6, 178.4];
  },

  async getRecentWorkouts(limit: number): Promise<WorkoutSample[]> {
    const all: WorkoutSample[] = [
      { id: '1', name: 'Trail run', when: daysAgo(0, 8, 2), source: 'Apple Health', distanceMi: 7.8, avgHeartRate: 148, durationMin: 52 },
      { id: '2', name: 'Lunch walk', when: daysAgo(1, 12, 20), source: 'Apple Health', distanceMi: 2.4, avgHeartRate: 96, durationMin: 24 },
      { id: '3', name: 'Cycling', when: daysAgo(2, 9, 15), source: 'Strava → Health Connect', distanceMi: 14.2, avgHeartRate: 132, durationMin: 58 },
      { id: '4', name: 'Strength', when: daysAgo(3, 18, 30), source: 'Apple Watch', avgHeartRate: 118, durationMin: 40 },
      { id: '5', name: 'Evening walk', when: daysAgo(4, 19, 45), source: 'Apple Health', distanceMi: 1.9, avgHeartRate: 92, durationMin: 22 },
      // A lighter-paced 4-week baseline behind the busier week above —
      // together they give computeReadiness() (src/health/readiness.ts) a
      // real acute:chronic ratio to react to (this week reads noticeably
      // busier than the last month), rather than everything landing in
      // the no-history "insufficient_data" state in Expo Go / this
      // sandbox / web, where this provider is what's actually running.
      { id: '6', name: 'Strength', when: daysAgo(7, 17, 30), source: 'Apple Watch', avgHeartRate: 121, durationMin: 30 },
      { id: '7', name: 'Easy jog', when: daysAgo(9, 7, 45), source: 'Apple Health', distanceMi: 2.6, avgHeartRate: 128, durationMin: 35 },
      { id: '8', name: 'Cycling', when: daysAgo(11, 9, 0), source: 'Strava → Health Connect', distanceMi: 6.1, avgHeartRate: 124, durationMin: 28 },
      { id: '9', name: 'Strength', when: daysAgo(14, 18, 0), source: 'Apple Watch', avgHeartRate: 119, durationMin: 32 },
      { id: '10', name: 'Evening walk', when: daysAgo(16, 19, 30), source: 'Apple Health', distanceMi: 1.7, avgHeartRate: 90, durationMin: 25 },
      { id: '11', name: 'Easy jog', when: daysAgo(18, 8, 10), source: 'Apple Health', distanceMi: 2.2, avgHeartRate: 126, durationMin: 30 },
      { id: '12', name: 'Strength', when: daysAgo(21, 17, 45), source: 'Apple Watch', avgHeartRate: 120, durationMin: 28 },
      { id: '13', name: 'Lunch walk', when: daysAgo(23, 12, 15), source: 'Apple Health', distanceMi: 1.5, avgHeartRate: 94, durationMin: 20 },
      { id: '14', name: 'Cycling', when: daysAgo(25, 9, 30), source: 'Strava → Health Connect', distanceMi: 6.8, avgHeartRate: 123, durationMin: 32 },
      { id: '15', name: 'Easy jog', when: daysAgo(27, 7, 50), source: 'Apple Health', distanceMi: 2.0, avgHeartRate: 127, durationMin: 25 },
    ];
    return all.slice(0, limit);
  },

  async getDailyStepsSince(since: Date): Promise<DailyStepsWithDate[]> {
    // Cycles through the same sample counts getWeeklySteps() uses — this
    // is sample data standing in for a device, so there's no real
    // steps-to-miles relationship to preserve, just a plausible-looking
    // one (same rough ratio getSnapshot()'s 8,432 steps / 3.8 mi implies).
    const counts = [5680, 8090, 3760, 6790, 8810, 3210, 8432];
    const out: DailyStepsWithDate[] = [];
    const cursor = dateOnly(since);
    const today = dateOnly(new Date());
    let i = 0;
    while (cursor.getTime() <= today.getTime()) {
      const steps = counts[i % counts.length];
      out.push({ date: dateKey(cursor), steps, distanceMi: Math.round((steps / 2200) * 10) / 10 });
      cursor.setDate(cursor.getDate() + 1);
      i++;
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

function daysAgo(days: number, hour: number, minute: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d;
}
