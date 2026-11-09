import { supabase } from '../lib/supabase';

// Each player's Kennel hound in a challenge, as a hound code (0168's
// tag_hounds, which any game's players can read), for drawing them on a
// race scene. Empty for bots, and off the backend.
export async function getChallengeHounds(challengeId: string): Promise<Map<string, string | null>> {
  if (!supabase) return new Map();
  const { data, error } = await supabase.rpc('tag_hounds', { p_challenge_id: challengeId });
  if (error) return new Map();
  return new Map(((data ?? []) as { user_id: string; hound: string | null }[]).map((r) => [r.user_id, r.hound]));
}
