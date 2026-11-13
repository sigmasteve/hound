import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { APP_VERSION } from '../lib/appVersion';
import { compareVersions } from '../updates/versionGate';

// Pack Activities' live steps and location (1.2.0's native modules).
//
// Steps since the start: iPhone asks its motion chip directly
// (CMPedometer through expo-sensors), which counts even while Hound was
// closed. Android adds the live step counter to what Health Connect had
// when the screen opened.
//
// Location, when the Pack Activities' map is on: while the screen is open, and
// in the background through a location task (iPhone shows the blue
// location pill; Android a "Sharing your spot with your pack"
// notification). It stops when the Pack Activity ends or you stop sharing.

export const PACK_FUN_LOCATION_TASK = 'hound-pack-fun-location';
const ACTIVE_KEY = 'packfun:active';

type Sensors = typeof import('expo-sensors');
type Location = typeof import('expo-location');
type TaskManager = typeof import('expo-task-manager');

let mods: { sensors: Sensors; location: Location; tasks: TaskManager } | null | undefined;
export function packFunModules() {
  if (mods !== undefined) return mods;
  mods = null;
  if (Platform.OS === 'web') return mods;
  if (APP_VERSION !== 'unknown' && compareVersions(APP_VERSION, '1.2.0') < 0) return mods;
  try {
    /* eslint-disable @typescript-eslint/no-var-requires */
    mods = { sensors: require('expo-sensors'), location: require('expo-location'), tasks: require('expo-task-manager') };
    /* eslint-enable @typescript-eslint/no-var-requires */
  } catch {
    mods = null;
  }
  return mods;
}

export function hasLiveFeatures(): boolean {
  return packFunModules() !== null;
}

// iPhone: steps since `start` from the motion chip (null if unavailable).
export async function pedometerStepsSince(start: Date): Promise<number | null> {
  const m = packFunModules();
  if (!m || Platform.OS !== 'ios') return null;
  try {
    if (!(await m.sensors.Pedometer.isAvailableAsync())) return null;
    const perm = await m.sensors.Pedometer.requestPermissionsAsync();
    if (!perm.granted) return null;
    const r = await m.sensors.Pedometer.getStepCountAsync(start, new Date());
    return r.steps;
  } catch {
    return null;
  }
}

// Live steps while the screen is open (both platforms): calls back with
// steps since watching began. Returns a stop function.
export function watchLiveSteps(onSteps: (sinceWatch: number) => void): () => void {
  const m = packFunModules();
  if (!m) return () => {};
  let sub: { remove: () => void } | null = null;
  let stopped = false;
  (async () => {
    try {
      // Android asks for Physical activity first; iPhone for Motion.
      if (!(await m.sensors.Pedometer.isAvailableAsync())) return;
      if (!(await m.sensors.Pedometer.requestPermissionsAsync()).granted) return;
      if (!stopped) sub = m.sensors.Pedometer.watchStepCount((r) => onSteps(r.steps));
    } catch {
      // No live counter: Health's steps still go up as it syncs.
    }
  })();
  return () => {
    stopped = true;
    sub?.remove();
  };
}

export async function askLocation(): Promise<boolean> {
  const m = packFunModules();
  if (!m) return false;
  try {
    const r = await m.location.requestForegroundPermissionsAsync();
    return r.granted;
  } catch {
    return false;
  }
}

export async function currentSpot(): Promise<{ lat: number; lng: number } | null> {
  const m = packFunModules();
  if (!m) return null;
  try {
    const perm = await m.location.getForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const p = await m.location.getCurrentPositionAsync({ accuracy: m.location.Accuracy.Balanced });
    return { lat: p.coords.latitude, lng: p.coords.longitude };
  } catch {
    return null;
  }
}

// The Pack Activity the background task reports for.
export interface ActivePackFun {
  id: string;
  startsAt: string;
  endsAt: string;
  steps: number;
}

export async function setActivePackFun(a: ActivePackFun | null): Promise<void> {
  try {
    if (a) await AsyncStorage.setItem(ACTIVE_KEY, JSON.stringify(a));
    else await AsyncStorage.removeItem(ACTIVE_KEY);
  } catch {
    // Only the background updates use this.
  }
}

export async function getActivePackFun(): Promise<ActivePackFun | null> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_KEY);
    return raw ? (JSON.parse(raw) as ActivePackFun) : null;
  } catch {
    return null;
  }
}

export async function startBackgroundSharing(a: ActivePackFun): Promise<boolean> {
  const m = packFunModules();
  if (!m) return false;
  try {
    await setActivePackFun(a);
    if (await m.location.hasStartedLocationUpdatesAsync(PACK_FUN_LOCATION_TASK)) return true;
    await m.location.startLocationUpdatesAsync(PACK_FUN_LOCATION_TASK, {
      accuracy: m.location.Accuracy.Balanced,
      distanceInterval: 25,
      timeInterval: 30_000,
      deferredUpdatesInterval: 30_000,
      pausesUpdatesAutomatically: false,
      activityType: m.location.ActivityType.Fitness,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Pack Activities',
        notificationBody: 'Sharing your spot with your pack until it ends.',
        notificationColor: '#9184d9',
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function stopBackgroundSharing(): Promise<void> {
  const m = packFunModules();
  await setActivePackFun(null);
  if (!m) return;
  try {
    if (await m.location.hasStartedLocationUpdatesAsync(PACK_FUN_LOCATION_TASK)) {
      await m.location.stopLocationUpdatesAsync(PACK_FUN_LOCATION_TASK);
    }
  } catch {
    // Already stopped.
  }
}

export async function isSharingInBackground(): Promise<boolean> {
  const m = packFunModules();
  if (!m) return false;
  try {
    return await m.location.hasStartedLocationUpdatesAsync(PACK_FUN_LOCATION_TASK);
  } catch {
    return false;
  }
}

// Distance in metres.
export function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(s));
}
