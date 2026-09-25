import { supabase } from '../lib/supabase';
import type { DailyProgressRow } from './streak';

// The two reads Daily Streak elimination needs, on top of what
// ChallengeDetailScreen already fetches — both plain selects against
// existing, already-RLS-open tables (progress_snapshots' "Participants
// can view challenge progress" and challenge_participants' "Participants
// can view each other" policies, both from 0001_challenges_schema.sql),
// so this needed no new migration at all.

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

// Every per-day row logged for this challenge, across every
// participant — unaggregated, unlike getLeaderboard's own read of this
// same table (which sums away the very `day` column streak elimination
// needs to walk day by day).
export async function listDailyProgress(challengeId: string): Promise<DailyProgressRow[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('progress_snapshots')
    .select('user_id, day, steps')
    .eq('challenge_id', challengeId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ userId: row.user_id, day: row.day as string, steps: row.steps }));
}

// When each current participant joined — the day someone joined (not
// the challenge's own start) is where their own streak clock actually
// starts, so someone who joins a week in doesn't get retroactively
// eliminated for days before they were ever a participant.
export async function listParticipantJoinDates(challengeId: string): Promise<Map<string, Date>> {
  const client = requireClient();
  const { data, error } = await client
    .from('challenge_participants')
    .select('user_id, joined_at')
    .eq('challenge_id', challengeId);
  if (error) throw new Error(error.message);
  const map = new Map<string, Date>();
  for (const row of data ?? []) map.set(row.user_id, new Date(row.joined_at as string));
  return map;
}
