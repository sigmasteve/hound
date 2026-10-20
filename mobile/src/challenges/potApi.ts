import { supabase } from '../lib/supabase';

// Challenge pots and global prizes (0107_challenge_pot.sql). The server
// checks everything; every call throws its message on failure.

// What a creator can set a pot's entry to.
export const POT_CHOICES = [10, 25, 50, 100];

// Kinds that can have a pot (and never a global challenge). A Bingo's
// pot needs the 'hound' card (0117_hound_bingo.sql), which every new one
// gets.
export const POT_KINDS = ['steps', 'tictacgo', 'bingo'];

// What the admin's prize fields start at for a new global challenge.
export const DEFAULT_GLOBAL_PRIZES: [number, number, number] = [100, 50, 25];

export interface ChallengePot {
  potBones: number | null;
  total: number;
  players: string[];
  iAmIn: boolean;
  // Still taking entries (until a day after the challenge starts).
  open: boolean;
  settled: boolean;
  winners: string[];
  // Settled with everyone's entry back.
  refunded: boolean;
}

function client() {
  if (!supabase) throw new Error('Pots need a connection to Hound.');
  return supabase;
}

export async function setChallengePot(challengeId: string, bones: number | null): Promise<void> {
  const { error } = await client().rpc('set_challenge_pot', { p_challenge_id: challengeId, p_bones: bones });
  if (error) throw new Error(error.message);
}

export async function joinChallengePot(challengeId: string): Promise<number> {
  const { data, error } = await client().rpc('join_challenge_pot', { p_challenge_id: challengeId });
  if (error) throw new Error(error.message);
  return data as number;
}

export async function getChallengePot(challengeId: string): Promise<ChallengePot> {
  const { data, error } = await client().rpc('challenge_pot', { p_challenge_id: challengeId }).single();
  if (error) throw new Error(error.message);
  const r = data as any;
  return {
    potBones: r.pot_bones,
    total: r.total ?? 0,
    players: r.players ?? [],
    iAmIn: r.i_am_in,
    open: r.open,
    settled: r.settled,
    winners: r.winners ?? [],
    refunded: r.refunded,
  };
}

// Admin only: Bones for 1st, 2nd and 3rd in a global challenge.
export async function setGlobalPrizes(challengeId: string, prizes: [number, number, number]): Promise<void> {
  const { error } = await client().rpc('set_global_prizes', {
    p_challenge_id: challengeId,
    p_first: prizes[0],
    p_second: prizes[1],
    p_third: prizes[2],
  });
  if (error) throw new Error(error.message);
}

// A global challenge's prizes for 1st, 2nd and 3rd, or null for none.
export async function getGlobalPrizes(challengeId: string): Promise<[number, number, number] | null> {
  const { data, error } = await client().from('challenges').select('prize_bones').eq('id', challengeId).maybeSingle();
  if (error || !data) return null;
  const p = (data as { prize_bones?: number[] | null }).prize_bones;
  return p && p.length === 3 ? [p[0], p[1], p[2]] : null;
}
