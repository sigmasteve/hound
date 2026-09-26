import { supabase } from '../lib/supabase';
import type { BingoCategory, BingoProgressRow } from './bingo';

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

async function requireUserId(): Promise<string> {
  const { data } = await requireClient().auth.getUser();
  if (!data.user) throw new Error('Sign in to do that.');
  return data.user.id;
}

// Every category any participant has ever filled for this challenge — see
// 0052_bingo_progress.sql's "Participants can view bingo progress" policy
// (any participant can read the whole challenge's rows, needed for the
// squares-filled leaderboard, not just the caller's own card).
export async function listBingoProgress(challengeId: string): Promise<BingoProgressRow[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('bingo_progress')
    .select('user_id, category, first_logged_at')
    .eq('challenge_id', challengeId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    userId: row.user_id,
    category: row.category as BingoCategory,
    firstLoggedAt: row.first_logged_at as string,
  }));
}

// Marks the caller's own square filled — a no-op if it's already filled
// (ignoreDuplicates, backed by the table's own (challenge_id, user_id,
// category) primary key), since syncBingoProgressFromDevice
// (deviceSync.ts) re-classifies every recent workout on every sync rather
// than tracking which ones it's already seen.
export async function recordBingoProgress(challengeId: string, category: BingoCategory): Promise<void> {
  const client = requireClient();
  const userId = await requireUserId();
  const { error } = await client
    .from('bingo_progress')
    .upsert(
      { challenge_id: challengeId, user_id: userId, category },
      { onConflict: 'challenge_id,user_id,category', ignoreDuplicates: true },
    );
  if (error) throw new Error(error.message);
}
