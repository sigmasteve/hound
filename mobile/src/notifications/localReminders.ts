import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { updateHound } from '../goals/hound';
import type { PendingAction } from '../challenges/pendingActions';

// Permission for on-device reminders, and the two reminder inputs Home
// and the daily bonus popup feed in. The reminders themselves are
// scheduled by the Hound (src/goals/hound.ts) at the user's own local
// times.
//
// Never prompts for permission on its own. The places that ask are
// deliberate, user-initiated ones: the daily bonus popup's "Remind me
// tomorrow" button and choosing a hounding level on the Goals screen.

const ENABLED_KEY = 'hound.localReminders.enabled';

// expo-notifications' scheduling APIs don't exist on web (this app also
// ships a react-native-web build) — everything below no-ops there.
const supported = Platform.OS !== 'web';

export type ReminderPermission = 'granted' | 'denied' | 'undetermined';

export async function getLocalRemindersEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ENABLED_KEY)) !== 'false';
  } catch {
    return true;
  }
}

export async function getReminderPermission(): Promise<ReminderPermission> {
  if (!supported) return 'denied';
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
  } catch {
    return 'denied';
  }
}

export async function requestReminderPermission(): Promise<boolean> {
  if (!supported) return false;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

// Turning reminders on walks through the OS permission prompt if it
// hasn't been answered yet, and throws (so the caller can revert its
// toggle) if notifications end up not allowed. Turning them off cancels
// anything already scheduled; the next Home load won't schedule more.
export async function setLocalRemindersEnabled(enabled: boolean): Promise<void> {
  if (enabled && (await getReminderPermission()) !== 'granted' && !(await requestReminderPermission())) {
    throw new Error('Notifications are turned off for Hound in your device settings.');
  }
  await AsyncStorage.setItem(ENABLED_KEY, enabled ? 'true' : 'false');
  if (!enabled) await cancelAll();
}

async function cancelAll(): Promise<void> {
  // The Hound owns every scheduled reminder now; with reminders turned
  // off it has nothing left to say.
  updateHound({ bonus: null, pending: [] });
}

// The daily bonus reminder and the "still on your list" nudge are part of
// the Hound now (src/goals/hound.ts), which decides when they go out and
// how many reminders fit in a day.
export async function scheduleDailyBonusReminder(nextStreak: number, nextBonus: number, currencyName: string): Promise<void> {
  updateHound({ bonus: { nextStreak, nextBonus, currencyName } });
}

export async function schedulePendingActionsNudge(actions: PendingAction[]): Promise<void> {
  updateHound({ pending: actions });
}
