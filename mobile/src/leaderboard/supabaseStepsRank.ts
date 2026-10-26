import { supabase } from '../lib/supabase';
import { localDayKey } from '../goals/goals';

// Global (not challenge-scoped) steps leaderboard — see
// 0027_daily_step_totals.sql for the table/RLS/rank functions this wraps.
// Nothing here ever reads another user's row: the two rank RPCs are
// security-definer functions that only ever return the caller's own rank
// plus a headcount, never anyone else's number or name.

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export interface StepRank {
  rank: number;
  totalUsers: number;
}

// Upserts today's total from the same HealthSnapshot.stepsToday every
// other screen already shows — keyed by the phone's own calendar day,
// like progress_snapshots (0129_step_rank_local_day.sql; it was the UTC
// day before, which turned over at 7 or 8pm in the US and sent evening
// steps to tomorrow). Safe to call on every Home load: it's an upsert.
export async function recordDailyStepTotal(userId: string, steps: number): Promise<void> {
  const client = requireClient();
  const day = localDayKey(new Date());
  const { error } = await client
    .from('daily_step_totals')
    .upsert({ user_id: userId, day, steps }, { onConflict: 'user_id,day' });
  if (error) throw new Error(error.message);
}

// The rank functions take the phone's date (0129); before that has run
// they take no arguments, so a failure is retried without one.
async function rpcForDay(fn: string): Promise<unknown> {
  const client = requireClient();
  const withDay = await client.rpc(fn, { p_day: localDayKey(new Date()) });
  if (!withDay.error) return withDay.data;
  const { data, error } = await client.rpc(fn);
  if (error) throw new Error(error.message);
  return data;
}

async function callRank(fn: 'my_daily_step_rank' | 'my_weekly_step_rank'): Promise<StepRank | null> {
  const data = await rpcForDay(fn);
  // No row back means the caller has no daily_step_totals entry in that
  // window yet — nothing to show, not a failure.
  const row = (data as { rank: number; total_users: number }[] | null)?.[0];
  return row ? { rank: row.rank, totalUsers: row.total_users } : null;
}

export function getMyDailyStepRank(): Promise<StepRank | null> {
  return callRank('my_daily_step_rank');
}

// Today's rank and yesterday's (0116_step_rank_yesterday.sql), for the
// Step rank tile on Today. Before 0116 has run, today's rank alone.
export interface StepRankChange extends StepRank {
  yesterdayRank: number | null;
}

export async function getMyDailyStepRankChange(): Promise<StepRankChange | null> {
  let data: unknown;
  try {
    data = await rpcForDay('my_daily_step_rank_change');
  } catch {
    const today = await getMyDailyStepRank();
    return today ? { ...today, yesterdayRank: null } : null;
  }
  const row = (data as { rank: number; total_users: number; yesterday_rank: number | null }[] | null)?.[0];
  return row ? { rank: row.rank, totalUsers: row.total_users, yesterdayRank: row.yesterday_rank } : null;
}

export function getMyWeeklyStepRank(): Promise<StepRank | null> {
  return callRank('my_weekly_step_rank');
}
