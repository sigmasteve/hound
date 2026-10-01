import type { Challenge } from './types';

// Deliberately duplicated rather than imported from
// supabaseChallenges.ts (which pulls in the Supabase client and RN
// polyfills) — this file stays a pure, dependency-free computation the
// same way board.ts's own isHuntConcluded/tagGroupGoalMet are. Must
// still agree exactly with progress_snapshots.day's own convention
// (see that file's recordProgress) — a local calendar day, not UTC,
// since that's what a day's steps are actually keyed by.
function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Daily Streak's own mechanic: "hit a daily goal every day, one miss
// and you're out." Deliberately computed from data that already
// exists (progress_snapshots' per-day rows, challenge_participants'
// own joined_at) rather than a new table or a scheduled job —
// elimination is a pure, stateless function of "did every fully-
// elapsed day since you joined meet the goal," same shape as
// isHuntConcluded/tagGroupGoalMet in board.ts being pure functions
// over already-fetched board state instead of a stored flag. Recomputed
// fresh on every load, so it can't drift from whatever's actually in
// progress_snapshots the way a cached elimination flag could.

export interface DailyProgressRow {
  userId: string;
  // Local calendar day key — see localDateKey's own comment for why
  // this has to match progress_snapshots.day's convention exactly.
  day: string;
  steps: number;
}

export interface StreakStatus {
  // Null while still alive; the day key of the first day they missed
  // the goal on, once they aren't. Permanent — nothing logged after
  // this day brings them back.
  eliminatedOnDay: string | null;
  // Consecutive goal-hitting days counted so far (still alive) or
  // before the day they were eliminated — not simply "days since
  // joining," since a day with zero logged steps still breaks it.
  streakDays: number;
}

// A challenge's calendar days as the caller's phone counts them
// (challengeDays.ts's getChallengeDays) — passed in rather than fetched
// here so this file stays dependency-free.
export interface ChallengeDayRange {
  firstDay: string;
  lastDay: string;
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDateKey(new Date(y, m - 1, d + n));
}

// Without a range from the server: the day the challenge starts on this
// phone, through its last day.
function fallbackRange(challenge: Challenge): ChallengeDayRange {
  const firstDay = localDateKey(new Date(challenge.startsAt));
  return { firstDay, lastDay: addDays(firstDay, challenge.durationDays - 1) };
}

// Every day key from `from` through `to`, inclusive — small ranges only
// (one challenge's own duration), so a plain loop is fine.
function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

// `joinedAtByUser` and `dailyRows` both come from streakApi.ts — see
// that file for why neither needs a new migration to fetch. A
// challenge with no real dailyGoalSteps set (shouldn't happen for a
// 'streak' challenge created through CreateScreen, but the column is
// nullable) has nothing to enforce, same "no goal, no-op" shape as
// tagGroupGoalMet's own `if (!goal) return false`.
export function computeStreakStatus(
  challenge: Challenge,
  joinedAtByUser: Map<string, Date>,
  dailyRows: DailyProgressRow[],
  range: ChallengeDayRange = fallbackRange(challenge),
): Map<string, StreakStatus> {
  const result = new Map<string, StreakStatus>();
  const goal = challenge.dailyGoalSteps;
  if (!goal) {
    for (const userId of joinedAtByUser.keys()) result.set(userId, { eliminatedOnDay: null, streakDays: 0 });
    return result;
  }

  const stepsByUserDay = new Map<string, number>();
  for (const row of dailyRows) stepsByUserDay.set(`${row.userId}:${row.day}`, row.steps);

  // "Today" is still in progress — its steps aren't final yet, so only
  // a fully-elapsed day (yesterday or earlier) can eliminate anyone.
  // Judged through yesterday, or the challenge's last day once it's
  // over — days after the end never count against anyone.
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = localDateKey(yesterday);
  const judgeThrough = yesterdayKey < range.lastDay ? yesterdayKey : range.lastDay;

  for (const [userId, joinedAt] of joinedAtByUser) {
    // From the challenge's first day — the same calendar day for
    // everyone, in their own time zone (0085_challenge_start_day.sql) —
    // or the day they joined, if later.
    const joinedDay = localDateKey(joinedAt);
    const from = joinedDay > range.firstDay ? joinedDay : range.firstDay;
    if (from > judgeThrough) {
      // Joined today (or the challenge itself hasn't had a full day
      // yet) — no elapsed day exists to judge them on.
      result.set(userId, { eliminatedOnDay: null, streakDays: 0 });
      continue;
    }
    let eliminatedOnDay: string | null = null;
    let streakDays = 0;
    for (const day of daysBetween(from, judgeThrough)) {
      const steps = stepsByUserDay.get(`${userId}:${day}`) ?? 0;
      if (steps < goal) {
        eliminatedOnDay = day;
        break;
      }
      streakDays += 1;
    }
    result.set(userId, { eliminatedOnDay, streakDays });
  }
  return result;
}

// Whether every current participant has already been eliminated —
// unlike a hunt (isHuntConcluded, board.ts), this deliberately does
// NOT end the challenge early: a Daily Streak runs its full scheduled
// duration regardless, the same "isChallengeFinished only cares about
// endsAt" treatment a Distance Pool's own cosmetic goal-met badge
// already gets. Used only for recap messaging once the challenge
// actually finishes (or to note "everyone's already out" while it's
// technically still running) — never to decide `finished` itself.
export function streakConcluded(statuses: Map<string, StreakStatus>): boolean {
  if (statuses.size === 0) return false;
  return Array.from(statuses.values()).every((s) => s.eliminatedOnDay !== null);
}
