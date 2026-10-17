import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { PendingAction } from '../challenges/pendingActions';
import { describeGoal, formatAmount, localDayKey, progressLine, workoutWord, type GoalProgress } from './goals';
import { saveHoundSettings, type HoundLevel } from './goalsApi';

// The Hound: the phone's own reminders about your goals, at your own
// local times. Everything the app used to schedule separately (the daily
// bonus reminder, the "still on your list" nudge) goes through here, so
// one setting decides how many you get in a day:
//
//   gentle      1 a day, in the evening (the default)
//   persistent  up to 3
//   relentless  up to 5
//   off         none
//
// Rebuilt from scratch whenever its inputs change (every Home load): all
// of today's remaining slots, and all of tomorrow's. A slot with nothing
// to say is skipped, so once every goal is done for the day the Hound
// goes quiet. Numbers in a reminder are as of when it was scheduled, and
// the text says so, because the phone can't check again before it fires.
//
// Tomorrow's slots cover a day the app isn't opened. The server's 9 PM
// reminder (send-login-reminders) only sends on days the phone hasn't
// scheduled, which hound_settings.scheduled_through tells it.

const SLOTS: Record<Exclude<HoundLevel, 'off'>, number[]> = {
  gentle: [19 * 60],
  persistent: [12 * 60 + 30, 17 * 60, 20 * 60],
  relentless: [10 * 60, 13 * 60, 16 * 60, 19 * 60, 21 * 60],
};

export const HOUND_LEVELS: { id: HoundLevel; name: string; detail: string }[] = [
  { id: 'gentle', name: 'Gentle', detail: 'One reminder in the evening, only if a goal is still open' },
  { id: 'persistent', name: 'Persistent', detail: 'Up to 3 a day: midday, afternoon and evening' },
  { id: 'relentless', name: 'Relentless', detail: 'Up to 5 a day, until every goal is done' },
  { id: 'off', name: 'Off', detail: 'No goal reminders' },
];

const ID_PREFIX = 'hound-';
// Ids the app used before the Hound; cancelled so they don't fire twice.
const LEGACY_IDS = ['hound-daily-bonus-reminder', 'hound-pending-actions-nudge'];
const ANDROID_CHANNEL_ID = 'reminders';
const MIN_LEAD_MS = 10 * 60 * 1000;
const supported = Platform.OS !== 'web';

interface HoundInputs {
  userId: string | null;
  level: HoundLevel | null;
  progress: GoalProgress[] | null;
  pending: PendingAction[];
  bonus: { nextStreak: number; nextBonus: number; currencyName: string } | null;
  // A goal streak that `day` (a local day key) could still break; 0
  // once that day's goals are done.
  streak: { count: number; day: string } | null;
}

const inputs: HoundInputs = { userId: null, level: null, progress: null, pending: [], bonus: null, streak: null };
let timer: ReturnType<typeof setTimeout> | null = null;
let lastSavedThrough: string | null = null;
// One reschedule at a time, so two can't cancel each other's reminders.
let running: Promise<void> = Promise.resolve();

// The bonus, the goal streak and the "still on your list" items only
// come from Home, so they're kept on the phone for a background refresh
// (background/backgroundSync.ts) to reuse when the app isn't open.
const SAVED_INPUTS_KEY = 'hound:saved-inputs';

function remember(patch: Partial<HoundInputs>): void {
  if (!('bonus' in patch) && !('pending' in patch) && !('streak' in patch)) return;
  AsyncStorage.setItem(
    SAVED_INPUTS_KEY,
    JSON.stringify({ bonus: inputs.bonus, pending: inputs.pending, streak: inputs.streak }),
  ).catch(() => {});
}

// Merges what changed and reschedules shortly after, so a burst of
// updates during one Home load schedules once.
export function updateHound(patch: Partial<HoundInputs>): void {
  Object.assign(inputs, patch);
  remember(patch);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    running = running.then(() =>
      reschedule().catch(() => {
        // Best-effort: a reminder that fails to schedule never shows as an
        // error anywhere.
      }),
    );
  }, 1500);
}

// For a background refresh: reschedules right away and waits for it,
// with the bonus and list items Home last saw.
export async function refreshHoundNow(patch: Partial<HoundInputs>): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  try {
    const saved = await AsyncStorage.getItem(SAVED_INPUTS_KEY);
    if (saved) Object.assign(inputs, JSON.parse(saved) as Partial<HoundInputs>);
  } catch {
    // Nothing saved: go without them.
  }
  Object.assign(inputs, patch);
  running = running.then(() => reschedule().catch(() => {}));
  await running;
}

async function permissionGranted(): Promise<boolean> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

async function cancelAllHound(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  const ids = new Set(LEGACY_IDS);
  for (const n of scheduled) if (n.identifier.startsWith(ID_PREFIX)) ids.add(n.identifier);
  await Promise.all([...ids].map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
}

function atMinutes(daysFromToday: number, minutes: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

function timeLabel(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Daily goals first (they reset tonight), then weekly ones that are
// behind pace.
function openGoals(progress: GoalProgress[]): GoalProgress[] {
  return progress
    .filter((p) => !p.done && p.behind)
    .sort((a, b) => (a.goal.period === b.goal.period ? a.goal.sort - b.goal.sort : a.goal.period === 'day' ? -1 : 1));
}

function effortHint(p: GoalProgress): string {
  if (p.goal.period !== 'day') return '';
  if (p.goal.metric === 'steps') {
    const min = Math.max(5, Math.round(p.remaining / 100 / 5) * 5);
    return ` That's about a ${min}-minute walk.`;
  }
  if (p.goal.metric === 'distance_mi') {
    const min = Math.max(5, Math.round((p.remaining * 20) / 5) * 5);
    return ` About ${min} minutes on foot.`;
  }
  return '';
}

function goalSentence(p: GoalProgress, asOf: string): string {
  const g = p.goal;
  if (g.metric === 'workouts') {
    const done = Math.round(p.value);
    const left = Math.ceil(p.remaining);
    const span = g.period === 'day' ? 'today' : p.daysLeft === 1 ? 'this week, and today is the last day' : `this week, ${p.daysLeft} days left`;
    return `${done} of ${g.target} ${workoutWord(g.activity, g.target)} ${span}. ${left} more to go.`;
  }
  const have = formatAmount(g.metric, p.value);
  const unit = g.metric === 'steps' ? ' steps' : '';
  return `As of ${asOf}: ${have}${unit}, ${progressLine(p).toLowerCase()}.${effortHint(p)}`;
}

const TODAY_TITLES = ["Hound's on you", 'Still on you', "The Hound doesn't let go", 'Not done yet', 'Last call'];

function todayMessage(slotIndex: number, slotCount: number, now: Date): { title: string; body: string } | null {
  const open = openGoals(inputs.progress ?? []);
  const pending = inputs.pending;
  if (open.length === 0 && pending.length === 0) return null;
  const title = slotIndex === slotCount - 1 && slotCount > 1 ? 'Last call' : TODAY_TITLES[Math.min(slotIndex, TODAY_TITLES.length - 2)];
  if (open.length === 0) {
    const [first, ...rest] = pending;
    return { title: 'Still on your list today', body: rest.length > 0 ? `${first.label}, and ${rest.length} more.` : `${first.label}.` };
  }
  let body = goalSentence(open[0], timeLabel(now));
  if (open.length > 1) body += ` Plus ${open.length - 1} more ${open.length - 1 === 1 ? 'goal' : 'goals'}.`;
  const streak = inputs.streak;
  if (streak && streak.count > 0 && streak.day === localDayKey(now) && open.some((p) => p.goal.period === 'day')) {
    body += ` Keep your ${streak.count}-day streak going.`;
  }
  if (pending.length > 0) body += ` ${pending.length} ${pending.length === 1 ? 'thing is' : 'things are'} waiting on you.`;
  return { title, body };
}

function tomorrowMessage(slotIndex: number): { title: string; body: string } | null {
  const progress = inputs.progress ?? [];
  const daily = progress.filter((p) => p.goal.period === 'day').map((p) => shortGoal(p));
  const bonus = inputs.bonus;
  const goalsText = daily.length > 0 ? listText(daily.slice(0, 3)) : null;
  if (slotIndex === 0) {
    const parts: string[] = [];
    if (goalsText) parts.push(`Today: ${goalsText}.`);
    if (bonus) parts.push(`Your daily bonus is waiting: +${bonus.nextBonus} ${bonus.currencyName}.`);
    if (parts.length === 0) return null;
    return { title: 'New day, same Hound', body: parts.join(' ') };
  }
  if (!goalsText) return null;
  return { title: "Hound hasn't seen you today", body: `${goalsText[0].toUpperCase()}${goalsText.slice(1)} are still on the table.` };
}

function shortGoal(p: GoalProgress): string {
  const g = p.goal;
  if (g.label) return g.label;
  return describeGoal(g).replace(/ a day$/, '');
}

function listText(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

async function schedule(id: string, at: Date, title: string, body: string): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: { title, body, sound: 'default', data: { kind: 'hound' } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: ANDROID_CHANNEL_ID },
  });
}

async function reschedule(): Promise<void> {
  if (!supported || inputs.level === null) return;
  await cancelAllHound();
  if (inputs.level === 'off' || !(await permissionGranted())) return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const slots = SLOTS[inputs.level];
  const now = new Date();
  for (const [day, compose] of [
    [0, (i: number) => todayMessage(i, slots.length, now)],
    [1, (i: number) => tomorrowMessage(i)],
  ] as const) {
    for (let i = 0; i < slots.length; i++) {
      const at = atMinutes(day, slots[i]);
      if (at.getTime() - now.getTime() < MIN_LEAD_MS) continue;
      const message = compose(i);
      if (!message) continue;
      await schedule(`${ID_PREFIX}${localDayKey(at)}-${i}`, at, message.title, message.body);
    }
  }

  // Tell the server the phone has today and tomorrow covered, so its own
  // 9 PM reminder stays quiet.
  const through = localDayKey(atMinutes(1, 0));
  if (inputs.userId && through !== lastSavedThrough) {
    await saveHoundSettings(inputs.userId, { scheduledThrough: through });
    lastSavedThrough = through;
  }
}
