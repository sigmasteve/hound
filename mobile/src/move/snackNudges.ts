import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { localDayKey } from '../fasting/fasting';
import { SNACK_WINDOWS, type MySnacks, type SnackWindow } from './moveApi';

// Movement snacks' nudges (0275): the phone's own notifications, not
// pushes. One at a random time inside each window you picked, for today
// (if it's still ahead) and the next two days, so they keep coming even
// if Hound isn't opened every day. Today's stop once the day's paid
// snacks are used up. Rescheduled when the settings change, and from Move
// and Today (from what was last saved here, with no server call).

const SAVED_KEY = 'hound:snack-nudges';
const PREFIX = 'move-snack-';
const CHANNEL = 'reminders';
const DAYS = 3;

interface Saved {
  enabled: boolean;
  windows: SnackWindow[];
  steps: number;
  minutes: number;
  bones: number;
  // Today's paid snacks have run out (as of the last save).
  doneForDay: string | null;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return Math.abs(h);
}

async function cancelAll(): Promise<void> {
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      all.filter((n) => n.identifier.startsWith(PREFIX)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {})),
    );
  } catch {
    // Nothing scheduled to cancel.
  }
}

async function schedule(s: Saved): Promise<void> {
  if (Platform.OS === 'web') return;
  await cancelAll();
  if (!s.enabled || s.windows.length === 0) return;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;
  const now = Date.now();
  for (let d = 0; d < DAYS; d++) {
    const day = new Date();
    day.setDate(day.getDate() + d);
    const key = localDayKey(day);
    if (s.doneForDay === key) continue;
    for (const w of SNACK_WINDOWS.filter((x) => s.windows.includes(x.id))) {
      const at = new Date(day);
      // A minute in the window that looks random but is the same each
      // time it's worked out (so rescheduling doesn't move it), leaving
      // room to finish inside the window.
      const span = Math.max(1, (w.to - w.from) * 60 - s.minutes);
      at.setHours(w.from, 0, 0, 0);
      at.setMinutes(hash(`${key}-${w.id}`) % span);
      if (at.getTime() <= now + 60000) continue;
      await Notifications.scheduleNotificationAsync({
        identifier: `${PREFIX}${key}-${w.id}`,
        content: {
          title: '🐾 Movement snack',
          body: `${s.steps} steps in the next ${s.minutes} minutes?${s.bones > 0 ? ` +${s.bones} Bones` : ''}`,
          sound: 'default',
          data: { type: 'move_snack' },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: CHANNEL },
      }).catch(() => {});
    }
  }
}

// After reading or changing the settings (Move, the snack screen).
export async function saveSnackNudges(m: MySnacks, now = new Date()): Promise<void> {
  const saved: Saved = {
    enabled: m.enabled,
    windows: m.windows,
    steps: m.steps,
    minutes: m.minutes,
    bones: m.bones,
    doneForDay: m.maxDay > 0 && m.today.paid >= m.maxDay ? localDayKey(now) : null,
  };
  try {
    await AsyncStorage.setItem(SAVED_KEY, JSON.stringify(saved));
  } catch {
    // Still schedule from what we have.
  }
  await schedule(saved).catch(() => {});
}

// From Today: keep the next days filled in, from what was last saved.
export async function refreshSnackNudges(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(SAVED_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Saved;
    if (!saved.enabled) return;
    await schedule(saved);
  } catch {
    // A missed nudge is fine.
  }
}
