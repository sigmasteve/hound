import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { PendingAction } from '../challenges/pendingActions';

// On-device reminders, scheduled locally with expo-notifications rather
// than pushed from a server job — so they fire at the user's own local
// time (the server-side send-login-reminders fires once at a fixed UTC
// hour for everyone, see its own TODO) and can say something specific
// about this user's day. Both are rescheduled from scratch on every Home
// load, under a fixed identifier, so a newer schedule always replaces the
// previous one instead of stacking duplicates:
//   - daily bonus: tomorrow at 6pm, "your bonus is waiting" — pushed back
//     a day every time the app is opened, so it only ever fires on a day
//     the user hasn't opened the app by then
//   - pending actions: today at 7pm, only if something's actually waiting
//     (Home's own Needs Attention list), cancelled once nothing is
//
// Never prompts for permission on its own: scheduling silently does
// nothing unless notifications are already allowed. The two places that
// do ask are deliberate, user-initiated ones — the daily bonus popup's
// "Remind me tomorrow" button and Settings' own toggle.

const BONUS_REMINDER_ID = 'hound-daily-bonus-reminder';
const PENDING_NUDGE_ID = 'hound-pending-actions-nudge';
const ENABLED_KEY = 'hound.localReminders.enabled';
const ANDROID_CHANNEL_ID = 'reminders';
const BONUS_REMINDER_HOUR = 18;
const PENDING_NUDGE_HOUR = 19;

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

async function canSchedule(): Promise<boolean> {
  return supported && (await getLocalRemindersEnabled()) && (await getReminderPermission()) === 'granted';
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Reminders',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

async function scheduleAt(identifier: string, date: Date, title: string, body: string): Promise<void> {
  await ensureAndroidChannel();
  await Notifications.scheduleNotificationAsync({
    identifier,
    content: { title, body, sound: 'default' },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: ANDROID_CHANNEL_ID },
  });
}

async function cancel(identifier: string): Promise<void> {
  if (!supported) return;
  await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => {});
}

async function cancelAll(): Promise<void> {
  await Promise.all([cancel(BONUS_REMINDER_ID), cancel(PENDING_NUDGE_ID)]);
}

function atLocalHour(daysFromToday: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  d.setHours(hour, 0, 0, 0);
  return d;
}

// Best-effort throughout — a reminder that fails to schedule should never
// surface as an error on Home.
export async function scheduleDailyBonusReminder(nextStreak: number, nextBonus: number, currencyName: string): Promise<void> {
  try {
    if (!(await canSchedule())) return;
    const body =
      nextStreak > 1
        ? `Open Hound to claim +${nextBonus} ${currencyName} and make it a ${nextStreak}-day streak.`
        : `Open Hound to claim +${nextBonus} ${currencyName}.`;
    await scheduleAt(BONUS_REMINDER_ID, atLocalHour(1, BONUS_REMINDER_HOUR), 'Your daily bonus is waiting', body);
  } catch {
    // See this function's own comment.
  }
}

export async function schedulePendingActionsNudge(actions: PendingAction[]): Promise<void> {
  try {
    if (actions.length === 0 || !(await canSchedule())) {
      await cancel(PENDING_NUDGE_ID);
      return;
    }
    const at = atLocalHour(0, PENDING_NUDGE_HOUR);
    // Already past tonight's slot — nothing useful left to schedule today;
    // tomorrow's first Home load reschedules against tomorrow's list.
    if (at.getTime() <= Date.now()) {
      await cancel(PENDING_NUDGE_ID);
      return;
    }
    const [first, ...rest] = actions;
    const body = rest.length > 0 ? `${first.label} — and ${rest.length} more.` : `${first.label}.`;
    await scheduleAt(PENDING_NUDGE_ID, at, 'Still on your list today', body);
  } catch {
    // Same best-effort reasoning as scheduleDailyBonusReminder.
  }
}
