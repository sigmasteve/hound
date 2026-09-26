import { supabase } from '../lib/supabase';
import type { CosmeticSlot } from './catalog';

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export interface EquippedCosmetics {
  frameId: string | null;
  backgroundId: string | null;
}

export async function getMyEquippedCosmetics(userId: string): Promise<EquippedCosmetics> {
  const client = requireClient();
  const { data, error } = await client
    .from('profiles')
    .select('equipped_frame_id, equipped_background_id')
    .eq('id', userId)
    .single();
  if (error) throw new Error(error.message);
  return { frameId: data.equipped_frame_id as string | null, backgroundId: data.equipped_background_id as string | null };
}

// p_item_id null un-equips that slot — always allowed. A non-null id the
// caller hasn't unlocked yet (checked server-side against their own real
// xp_total, see 0059_cosmetics.sql's equip_cosmetic) throws.
export async function equipCosmetic(slot: CosmeticSlot, itemId: string | null): Promise<void> {
  const { error } = await requireClient().rpc('equip_cosmetic', { p_slot: slot, p_item_id: itemId });
  if (error) throw new Error(error.message);
}
