import { supabase } from '../lib/supabase';
import type { ChallengeKind } from '../data/sampleData';

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

// Which challenge kinds are gated behind bonesEarnedTotal (see
// scoreApi.ts) and how much each needs — backed by
// challenge_unlock_gates (0067_challenge_unlock_gates.sql), editable
// from the Admin screen. A kind absent from this map is always unlocked.
export type ChallengeUnlockGates = Partial<Record<ChallengeKind, number>>;

export async function listChallengeUnlockGates(): Promise<ChallengeUnlockGates> {
  const client = requireClient();
  const { data, error } = await client.from('challenge_unlock_gates').select('kind, bones_required');
  if (error) throw new Error(error.message);
  const gates: ChallengeUnlockGates = {};
  for (const row of data ?? []) {
    gates[row.kind as ChallengeKind] = row.bones_required as number;
  }
  return gates;
}

// Gates or re-thresholds one kind — challenge_unlock_gates' own RLS is
// the real enforcement (admin-only insert/update), this just upserts so
// the Admin screen doesn't need to know whether a kind was already gated.
export async function setChallengeUnlockGate(kind: ChallengeKind, bonesRequired: number): Promise<void> {
  const client = requireClient();
  const { error } = await client
    .from('challenge_unlock_gates')
    .upsert({ kind, bones_required: bonesRequired, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

// Ungates a kind entirely — deleting the row, not zeroing it out, since
// 0 Bones isn't a valid threshold (see the table's own check constraint).
export async function removeChallengeUnlockGate(kind: ChallengeKind): Promise<void> {
  const client = requireClient();
  const { error } = await client.from('challenge_unlock_gates').delete().eq('kind', kind);
  if (error) throw new Error(error.message);
}
