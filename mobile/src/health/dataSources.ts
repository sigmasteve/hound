// "Where your data comes from" (Connect screen, Android): which apps
// wrote steps and workouts to Health Connect lately, and which of them
// Hound's step total actually counts. Health Connect keeps only the
// highest-priority app when two cover the same minutes (the person sets
// that order in Health Connect), so an app can write steps and still not
// count — expected, but confusing without this.

export interface DataSourceSummary {
  // The writing app's package name, e.g. com.sec.android.app.shealth.
  packageName: string;
  name: string;
  // Raw steps this app wrote in the window — before Health Connect drops
  // overlaps, so these can add up to more than the counted total.
  steps: number;
  workouts: number;
  // Whether Health Connect's own total used this app's steps.
  countedForSteps: boolean;
  lastAt: string | null;
}

export interface DataSourcesReport {
  days: number;
  // Health Connect's total for the window — what Hound uses.
  countedSteps: number;
  sources: DataSourceSummary[];
}

// Friendly names for the apps people actually connect. Anything else
// shows its package name.
const KNOWN_APPS: Record<string, string> = {
  'com.sec.android.app.shealth': 'Samsung Health',
  'com.samsung.android.wear.shealth': 'Samsung Health (watch)',
  'com.whoop.android': 'WHOOP',
  'com.google.android.apps.fitness': 'Google Fit',
  'com.fitbit.FitbitMobile': 'Google Health (Fitbit)',
  'com.google.android.apps.healthdata': 'This phone',
  'com.google.android.healthconnect.controller': 'This phone',
  android: 'This phone',
  'com.garmin.android.apps.connectmobile': 'Garmin Connect',
  'com.ouraring.oura': 'Oura',
  'com.strava': 'Strava',
  'com.runtastic.android': 'adidas Running',
  'com.nike.plusgps': 'Nike Run Club',
  'com.polar.polarflow': 'Polar Flow',
  'com.suunto.connectivity': 'Suunto',
  'com.xiaomi.wearable': 'Mi Fitness',
  'com.mc.miband1': 'Notify for Mi Band',
  'com.huawei.health': 'Huawei Health',
  'com.withings.wiscale2': 'Withings',
  'com.myfitnesspal.android': 'MyFitnessPal',
  'com.peloton.callisto': 'Peloton',
  'com.zepp.app': 'Zepp',
  'com.coros.coros': 'COROS',
};

export const WHOOP_PACKAGE = 'com.whoop.android';
// Steps the phone counted itself (Android 14+ Health Connect step tracking).
const PHONE_PACKAGES = ['android', 'com.google.android.apps.healthdata', 'com.google.android.healthconnect.controller'];
export const SAMSUNG_HEALTH_PACKAGES = ['com.sec.android.app.shealth', 'com.samsung.android.wear.shealth'];

export function appName(packageName: string): string {
  return KNOWN_APPS[packageName] ?? packageName;
}

export type DataSourceIssue = { tone: 'warn' | 'info'; text: string };

// Plain-language notes on what the report shows, most important first.
export function diagnose(report: DataSourcesReport): DataSourceIssue[] {
  const issues: DataSourceIssue[] = [];
  const stepSources = report.sources.filter((s) => s.steps > 0);
  const workoutSources = report.sources.filter((s) => s.workouts > 0);
  const whoop = report.sources.find((s) => s.packageName === WHOOP_PACKAGE);
  const samsung = report.sources.find((s) => SAMSUNG_HEALTH_PACKAGES.includes(s.packageName));

  if (stepSources.length === 0) {
    issues.push({
      tone: 'warn',
      text: `No app has shared steps with Health Connect in the last ${report.days} days, so Hound has none to count. Use the checklist below to turn on sharing in the app that counts your steps.`,
    });
  }
  if (whoop) {
    issues.push({
      tone: 'info',
      text: 'WHOOP shares workouts with Health Connect, but not steps — that’s a WHOOP limitation. Your steps come from your phone or another watch.',
    });
  }
  if (!samsung && stepSources.length > 0 && stepSources.every((s) => PHONE_PACKAGES.includes(s.packageName))) {
    issues.push({
      tone: 'info',
      text: 'Only your phone is counting steps. Use Samsung Health or a watch? Turn on its Health Connect sharing so those steps count too.',
    });
  }
  const notCounted = stepSources.filter((s) => !s.countedForSteps);
  if (notCounted.length > 0 && stepSources.length > 1) {
    issues.push({
      tone: 'info',
      text: `${notCounted.map((s) => s.name).join(' and ')} ${notCounted.length === 1 ? 'also shares' : 'also share'} steps, but Health Connect only counts one app for the same minutes, so nothing is counted twice. To change which app wins, open Health Connect → Data and access → Activity → Steps → Data sources and priority.`,
    });
  }
  if (workoutSources.length === 0) {
    issues.push({
      tone: 'info',
      text: `No workouts shared in the last ${report.days} days. If you logged one, check that the app that recorded it shares Exercise with Health Connect.`,
    });
  }
  return issues;
}

// The steps to get an Android phone's data flowing, in order.
export const ANDROID_SETUP_CHECKLIST: { title: string; detail: string }[] = [
  {
    title: 'Let Hound read your data',
    detail: 'Health Connect → Data and access → App permissions → Hound → allow Steps, Distance and Exercise.',
  },
  {
    title: 'Turn on Samsung Health sharing',
    detail:
      'Samsung Health → ⋮ → Settings → Health Connect → turn on syncing, then allow Steps, Distance and Exercise. Skip this if you don’t use Samsung Health.',
  },
  {
    title: 'Turn on WHOOP sharing',
    detail:
      'WHOOP → More → Account & Settings → Integrations → Health Connect → allow Exercise. WHOOP doesn’t share steps, so your phone or another watch counts those.',
  },
  {
    title: 'Keep syncing apps awake',
    detail:
      'Settings → Apps → Samsung Health (and Galaxy Wearable) → Battery → Unrestricted. Battery saving is the most common reason steps stop arriving.',
  },
  {
    title: 'Open the app that records your activity',
    detail:
      'Some apps only share after they’ve synced. Open Samsung Health, WHOOP or your watch app, let it sync, then come back to Hound.',
  },
];
