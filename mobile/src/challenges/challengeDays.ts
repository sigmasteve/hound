import { supabase } from '../lib/supabase';
import type { Challenge } from './types';

// Which of this phone's calendar days belong to a challenge
// (0085_challenge_start_day.sql, 0086_start_day_other_kinds.sql).
//
// A challenge starts at midnight in its creator's time zone. Everyone
// counts from that same calendar day in their own time zone — a
// challenge starting Oct 1 counts Oct 1 through its last day wherever
// you are, not "from 11 PM Sep 30" for someone an hour west of the
// creator.
export interface ChallengeDays {
  // 'YYYY-MM-DD', inclusive.
  firstDay: string;
  lastDay: string;
  // Set only for a challenge started "Now" (CreateScreen): workouts
  // logged earlier that same first day don't count. Null for one that
  // starts at the top of a day, where the whole first day counts.
  notBefore: Date | null;
}

export function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDaysToKey(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDayKey(new Date(y, m - 1, d + n));
}

// A "Now" start is stamped seconds before the row is inserted; "Today"
// and "Tomorrow" are midnights, normally hours away from it.
const NOW_START_WITHIN_MS = 2 * 60_000;

// start_day never changes once the creator's phone has set it (right
// after creating), so one read per challenge per app session is enough.
const startDayCache = new Map<string, string | null>();

async function fetchStartDay(challengeId: string): Promise<string | null> {
  if (startDayCache.has(challengeId)) return startDayCache.get(challengeId) ?? null;
  let day: string | null = null;
  if (supabase) {
    try {
      const { data, error } = await supabase.from('challenges').select('start_day').eq('id', challengeId).maybeSingle();
      // Before 0085 has run the column doesn't exist; fall back quietly.
      if (!error && typeof data?.start_day === 'string') day = data.start_day;
    } catch {
      // Offline: fall back, and try again next time.
      return null;
    }
  }
  startDayCache.set(challengeId, day);
  return day;
}

export async function getChallengeDays(challenge: Challenge): Promise<ChallengeDays> {
  const startsAt = new Date(challenge.startsAt);
  // Without a stored start day (older server), the old rule: the day
  // the challenge starts in this phone's time zone.
  const firstDay = (await fetchStartDay(challenge.id)) ?? localDayKey(startsAt);
  const lastDay = addDaysToKey(firstDay, challenge.durationDays - 1);
  const startedNow = Math.abs(startsAt.getTime() - new Date(challenge.createdAt).getTime()) < NOW_START_WITHIN_MS;
  return { firstDay, lastDay, notBefore: startedNow ? startsAt : null };
}

// Whether a workout falls inside the challenge for this phone.
export function workoutCounts(days: ChallengeDays, when: Date): boolean {
  const key = localDayKey(when);
  if (key < days.firstDay || key > days.lastDay) return false;
  return !days.notBefore || when >= days.notBefore;
}
