import { supabase } from '../lib/supabase';

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export interface HoundScore {
  houndScore: number;
  xpTotal: number;
  // Bones — the Phase 3 shop currency (0060_bones_shop.sql). Fetched
  // alongside Score/XP rather than through its own call: it lives on the
  // exact same profiles row every existing caller of this function
  // already reads.
  bonesBalance: number;
  // Lifetime Bones earned through play (0066_bones_earned_total.sql) —
  // never decreases when bonesBalance is spent or topped up by a
  // real-money purchase, so it's the one column safe to gate a
  // challenge-kind unlock on (see CHALLENGE_UNLOCK_BONES in sampleData.ts).
  bonesEarnedTotal: number;
}

export async function getMyHoundScore(userId: string): Promise<HoundScore> {
  const client = requireClient();
  const { data, error } = await client
    .from('profiles')
    .select('hound_score, xp_total, bones_balance, bones_earned_total')
    .eq('id', userId)
    .single();
  if (error) throw new Error(error.message);
  return {
    houndScore: data.hound_score as number,
    xpTotal: data.xp_total as number,
    bonesBalance: data.bones_balance as number,
    bonesEarnedTotal: data.bones_earned_total as number,
  };
}

// Safe to call for any challenge id, any time, from any participant —
// settle_challenge_score (0058_hound_score.sql) is a no-op unless that
// challenge has genuinely just concluded and hasn't been awarded yet.
// Every call site treats this the same best-effort way
// settleTagTimeout/settleTicTacGo already are (`.catch(() => {})`), not
// wrapped in its own try/catch here, so a caller that actually cares
// about a real failure still can.
export async function settleChallengeScore(challengeId: string): Promise<void> {
  const { error } = await requireClient().rpc('settle_challenge_score', { p_challenge_id: challengeId });
  if (error) throw new Error(error.message);
}
