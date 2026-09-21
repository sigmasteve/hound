import { supabase } from '../lib/supabase';

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
// other screen already shows — keyed by the UTC calendar day (see the
// migration's own comment on why that, not each user's local day like
// progress_snapshots uses). Safe to call on every Home load: it's an
// upsert, same "re-running this is deliberate and harmless" reasoning
// ChallengeDetailScreen's syncFromDevice already relies on.
export async function recordDailyStepTotal(userId: string, steps: number): Promise<void> {
  const client = requireClient();
  const day = new Date().toISOString().slice(0, 10);
  const { error } = await client
    .from('daily_step_totals')
    .upsert({ user_id: userId, day, steps }, { onConflict: 'user_id,day' });
  if (error) throw new Error(error.message);
}

async function callRank(fn: 'my_daily_step_rank' | 'my_weekly_step_rank'): Promise<StepRank | null> {
  const client = requireClient();
  const { data, error } = await client.rpc(fn);
  if (error) throw new Error(error.message);
  // No row back means the caller has no daily_step_totals entry in that
  // window yet — nothing to show, not a failure.
  const row = (data as { rank: number; total_users: number }[] | null)?.[0];
  return row ? { rank: row.rank, totalUsers: row.total_users } : null;
}

export function getMyDailyStepRank(): Promise<StepRank | null> {
  return callRank('my_daily_step_rank');
}

export function getMyWeeklyStepRank(): Promise<StepRank | null> {
  return callRank('my_weekly_step_rank');
}
