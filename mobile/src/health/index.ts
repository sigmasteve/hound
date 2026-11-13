import { Platform } from 'react-native';
import { mockProvider } from './mockProvider';
import type { HealthProvider } from './types';
import { withLoggedWorkouts } from '../workouts/loggedWorkouts';

export * from './types';

// Resolves to the real platform provider when its native module is linked
// and reachable, otherwise falls back to sample data — this is what makes
// the app runnable in Expo Go / this sandbox (no native modules) and on a
// real device/dev-client build alike, without screens caring which one
// they got. Never throws.
// Workouts logged by hand (0204) are merged into getRecentWorkouts here,
// once, so goals, Bingo, 75 Day, records and the rest count them like any
// other workout (see workouts/loggedWorkouts.ts).
export async function resolveHealthProvider(): Promise<HealthProvider> {
  return withLoggedWorkouts(await resolvePlatformProvider());
}

async function resolvePlatformProvider(): Promise<HealthProvider> {
  try {
    if (Platform.OS === 'ios') {
      const { iosHealthProvider } = await import('./iosProvider');
      const available = await iosHealthProvider.isAvailable();
      if (available) return iosHealthProvider;
      console.warn('[health] iosHealthProvider.isAvailable() returned false — using mock data.');
    } else if (Platform.OS === 'android') {
      const { androidHealthProvider } = await import('./androidProvider');
      const available = await androidHealthProvider.isAvailable();
      if (available) return androidHealthProvider;
      console.warn('[health] androidHealthProvider.isAvailable() returned false — using mock data.');
    }
  } catch (e) {
    // Most commonly: the native module isn't linked (Expo Go, web, or a
    // build with no dev-client) — but logging it, rather than swallowing
    // it silently, is the only way to tell that apart from a real bug in
    // the provider (e.g. AppleHealthKit being undefined because the
    // native module failed to register with the JS bridge) once this is
    // running somewhere other than this repo's own dev sandbox.
    console.warn('[health] Falling back to mock data — platform provider threw:', e);
  }
  return mockProvider;
}
