import type { Challenge } from './types';
import type { ChallengeDayRange } from './streak';

// Deliberately duplicated rather than imported from streak.ts (which
// duplicates it from supabaseChallenges.ts in turn) — this file stays a
// pure, dependency-free computation the same way streak.ts's own
// localDateKey is. Must still agree exactly with progress_snapshots.day/
// seventyfive_checkins.day's own convention — a local calendar day, not
// UTC, since that's what "today's checklist" actually means to whoever's
// looking at it.
function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDateKey(new Date(y, m - 1, d + n));
}

// Every day key from `from` through `to`, inclusive — small ranges only
// (one challenge's own duration), so a plain loop is fine. Same shape
// as streak.ts's own daysBetween.
function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

// 75 Day Challenge's own daily checklist — loosely modeled on "75 Hard".
// workout1/workout2Outdoor are device-tracked (see deviceSync.ts's
// syncSeventyFiveFromDevice); diet/water/reading/photo are self-report,
// honor-system checkboxes — Hound has no sensor for any of them.
export interface SeventyFiveCheckin {
  userId: string;
  // Local calendar day key — see localDateKey's own comment above.
  day: string;
  workout1Done: boolean;
  workout2OutdoorDone: boolean;
  dietDone: boolean;
  waterDone: boolean;
  readingDone: boolean;
  photoDone: boolean;
}

export function isSeventyFiveDayComplete(c: Pick<SeventyFiveCheckin, 'workout1Done' | 'workout2OutdoorDone' | 'dietDone' | 'waterDone' | 'readingDone' | 'photoDone'>): boolean {
  return c.workout1Done && c.workout2OutdoorDone && c.dietDone && c.waterDone && c.readingDone && c.photoDone;
}

export interface SeventyFiveStatus {
  // Consecutive complete days counted back from the most recent
  // fully-elapsed day — resets to 0 on any missed/incomplete day, but
  // (unlike Daily Streak's eliminatedOnDay) never ends the challenge for
  // that person: they keep going, and can start climbing again the very
  // next day. Softer than the real 75 Hard's "miss a day, start the
  // whole 75 over" rule on purpose — see 0062_seventyfive.sql's own
  // comment on why.
  currentStreak: number;
  // The best currentStreak ever reached during the challenge so far —
  // survives a reset, so someone who breaks a 40-day run on day 41 still
  // gets to see "40" as their best rather than watching it vanish.
  longestStreak: number;
}

// `joinedAtByUser` and `checkins` both come from seventyFiveApi.ts. Same
// "only a fully-elapsed day judges you" rule as computeStreakStatus —
// today's own checklist can still be in progress, so it never counts
// toward the streak math until it's yesterday.
export function computeSeventyFiveStatus(
  challenge: Challenge,
  joinedAtByUser: Map<string, Date>,
  checkins: SeventyFiveCheckin[],
  // The challenge's calendar days (challengeDays.ts); without one, the
  // day it starts on this phone through its last day.
  range?: ChallengeDayRange,
): Map<string, SeventyFiveStatus> {
  const result = new Map<string, SeventyFiveStatus>();

  const byUserDay = new Map<string, SeventyFiveCheckin>();
  for (const c of checkins) byUserDay.set(`${c.userId}:${c.day}`, c);

  const firstDay = range?.firstDay ?? localDateKey(new Date(challenge.startsAt));
  const lastDay = range?.lastDay ?? addDays(firstDay, challenge.durationDays - 1);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  // Days after the challenge ends never count as misses.
  const judgeThrough = localDateKey(yesterday) < lastDay ? localDateKey(yesterday) : lastDay;

  for (const [userId, joinedAt] of joinedAtByUser) {
    const joinedDay = localDateKey(joinedAt);
    const from = joinedDay > firstDay ? joinedDay : firstDay;
    if (from > judgeThrough) {
      // Joined today (or the challenge itself hasn't had a full day yet)
      // — no elapsed day exists to judge them on.
      result.set(userId, { currentStreak: 0, longestStreak: 0 });
      continue;
    }
    let currentStreak = 0;
    let longestStreak = 0;
    for (const day of daysBetween(from, judgeThrough)) {
      const row = byUserDay.get(`${userId}:${day}`);
      if (row && isSeventyFiveDayComplete(row)) {
        currentStreak += 1;
        longestStreak = Math.max(longestStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    }
    result.set(userId, { currentStreak, longestStreak });
  }
  return result;
}
