import type { Challenge } from './types';
import type { ChallengeDayRange } from './streak';

// Accountability challenge (0126_checklist.sql): a daily checklist kept
// with friends. The creator writes the shared list; everyone can add one
// line of their own; a day counts only when every item is ticked. Pure
// computation here, same split as seventyFive.ts / seventyFiveApi.ts.

export type ChecklistItemKind = 'manual' | 'workout' | 'mindfulness' | 'steps';

export interface ChecklistItem {
  id: string;
  challengeId: string;
  // Null: a shared item on the creator's list. Set: that person's own
  // line, which only they see on their list.
  ownerId: string | null;
  position: number;
  label: string;
  kind: ChecklistItemKind;
  // Only for kind 'steps'.
  stepsTarget: number | null;
  // A personal line counts from this day ('YYYY-MM-DD'); null for a
  // shared item (always counts).
  fromDay: string | null;
}

export interface ChecklistCheckin {
  userId: string;
  // Local calendar day key — see localDateKey below.
  day: string;
  itemId: string;
  done: boolean;
  // 'device': the phone ticked it (steps, a workout); 'tap': a finger.
  source: 'tap' | 'device';
}

export interface ChecklistStatus {
  // Same reset-on-a-miss, never-eliminated streak as 75 Day
  // (computeSeventyFiveStatus) — judged on fully elapsed days only.
  currentStreak: number;
  longestStreak: number;
  // Every complete day so far, elapsed or not — what the server scores.
  completeDays: number;
}

// What a new list starts from and what the "Add" chips offer. Steps and
// the two workout kinds tick themselves from the phone; the rest are a
// plain tap. The server caps the shared list (checklist_settings).
export interface ChecklistPreset {
  label: string;
  kind: ChecklistItemKind;
}

export const CHECKLIST_PRESETS: ChecklistPreset[] = [
  { label: 'Workout', kind: 'workout' },
  { label: 'Steps', kind: 'steps' },
  { label: 'Mindfulness', kind: 'mindfulness' },
  { label: 'Read or learn something', kind: 'manual' },
  { label: 'Drink enough water', kind: 'manual' },
  { label: 'No junk food', kind: 'manual' },
  { label: 'Sleep 7+ hours', kind: 'manual' },
  { label: 'Stretch', kind: 'manual' },
];

// The three the list opens with.
export const DEFAULT_CHECKLIST_KINDS: ChecklistItemKind[] = ['workout', 'steps', 'mindfulness'];

export const DEFAULT_STEPS_TARGET = 8_000;
export const MIN_STEPS_TARGET = 1_000;
export const MAX_STEPS_TARGET = 30_000;
export const DEFAULT_CHECKLIST_DAYS = 30;
// What the server uses when the admin setting can't be read.
export const DEFAULT_MAX_CHECKLIST_ITEMS = 6;
export const CHECKLIST_LABEL_MAX = 60;

// A workout that counts for the Mindfulness item. HealthKit names its
// types ("Yoga", "Pilates", "Mind and Body", "Tai Chi"); Health Connect
// and typed names vary, so this reads the name loosely.
export function isMindfulnessWorkout(name: string): boolean {
  return /yoga|pilates|meditat|mindful|mind and body|mind & body|tai chi|qi ?gong|breath/i.test(name);
}

// The label a steps item is written with — the count is the whole
// point, so it's in the words, not beside them.
export function stepsItemLabel(target: number): string {
  return `${target.toLocaleString()} steps`;
}

// What ticks an item on its own, for the row's hint. Short: it shares
// the row with the label, and the footnote under the list says more.
export function autoHint(kind: ChecklistItemKind): string | null {
  switch (kind) {
    case 'steps':
      return 'Auto · steps';
    case 'workout':
      return 'Auto · workouts';
    case 'mindfulness':
      return 'Auto · yoga, meditation';
    default:
      return null;
  }
}

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDateKey(new Date(y, m - 1, d + n));
}

function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

// Shared items in order, then this person's own line, for one day: the
// line only from the day it was written (0126's own rule, so adding one
// on day 10 doesn't undo days 1 to 9).
export function itemsForUser(items: ChecklistItem[], userId: string, day?: string): ChecklistItem[] {
  return items
    .filter((i) => i.ownerId === null || (i.ownerId === userId && (!day || !i.fromDay || i.fromDay <= day)))
    .sort((a, b) => (a.ownerId === null) === (b.ownerId === null) ? a.position - b.position : a.ownerId === null ? -1 : 1);
}

// Which of the day's items are ticked.
export function doneItemIds(checkins: ChecklistCheckin[], userId: string, day: string): Set<string> {
  const done = new Set<string>();
  for (const c of checkins) if (c.userId === userId && c.day === day && c.done) done.add(c.itemId);
  return done;
}

export function isChecklistDayComplete(items: ChecklistItem[], checkins: ChecklistCheckin[], userId: string, day: string): boolean {
  const mine = itemsForUser(items, userId, day);
  if (mine.length === 0) return false;
  const done = doneItemIds(checkins, userId, day);
  return mine.every((i) => done.has(i.id));
}

// Streaks and complete days for everyone, from flat rows. Same "only a
// fully elapsed day judges you" rule as computeSeventyFiveStatus: today
// can still be in progress, so it counts toward completeDays once done
// but never toward the streak until it's yesterday.
export function computeChecklistStatus(
  challenge: Challenge,
  joinedAtByUser: Map<string, Date>,
  items: ChecklistItem[],
  checkins: ChecklistCheckin[],
  range?: ChallengeDayRange,
): Map<string, ChecklistStatus> {
  const result = new Map<string, ChecklistStatus>();
  const firstDay = range?.firstDay ?? localDateKey(new Date(challenge.startsAt));
  const lastDay = range?.lastDay ?? addDays(firstDay, challenge.durationDays - 1);
  const today = localDateKey(new Date());
  const yesterday = addDays(today, -1);
  const judgeThrough = yesterday < lastDay ? yesterday : lastDay;

  for (const [userId, joinedAt] of joinedAtByUser) {
    const joinedDay = localDateKey(joinedAt);
    const from = joinedDay > firstDay ? joinedDay : firstDay;
    let currentStreak = 0;
    let longestStreak = 0;
    let completeDays = 0;
    if (from <= judgeThrough) {
      for (const day of daysBetween(from, judgeThrough)) {
        if (isChecklistDayComplete(items, checkins, userId, day)) {
          currentStreak += 1;
          longestStreak = Math.max(longestStreak, currentStreak);
          completeDays += 1;
        } else {
          currentStreak = 0;
        }
      }
    }
    if (today <= lastDay && today >= from && isChecklistDayComplete(items, checkins, userId, today)) completeDays += 1;
    result.set(userId, { currentStreak, longestStreak, completeDays });
  }
  return result;
}
