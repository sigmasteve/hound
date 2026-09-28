import { supabase } from '../lib/supabase';
import type { CosmeticSlot } from './catalog';

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export interface EquippedCosmetics {
  frameId: string | null;
  backgroundId: string | null;
  iconId: string | null;
}

export async function getMyEquippedCosmetics(userId: string): Promise<EquippedCosmetics> {
  const client = requireClient();
  const { data, error } = await client
    .from('profiles')
    .select('equipped_frame_id, equipped_background_id, equipped_icon_id')
    .eq('id', userId)
    .single();
  if (error) throw new Error(error.message);
  return {
    frameId: data.equipped_frame_id as string | null,
    backgroundId: data.equipped_background_id as string | null,
    iconId: data.equipped_icon_id as string | null,
  };
}

// p_item_id null un-equips that slot — always allowed. A non-null id the
// caller hasn't unlocked (leveled item) or bought (shop item) yet throws
// — checked server-side against their own real xp_total/purchase record,
// see equip_cosmetic in 0059_cosmetics.sql/0060_bones_shop.sql.
export async function equipCosmetic(slot: CosmeticSlot, itemId: string | null): Promise<void> {
  const { error } = await requireClient().rpc('equip_cosmetic', { p_slot: slot, p_item_id: itemId });
  if (error) throw new Error(error.message);
}

// Shop-only items (catalog.ts's costBones, not unlockXp) — see
// 0060_bones_shop.sql. Once bought, ownership is permanent; equipping it
// afterward is the same equipCosmetic call above.
export async function getMyPurchasedItemIds(userId: string): Promise<string[]> {
  const client = requireClient();
  const { data, error } = await client.from('cosmetic_purchases').select('item_id').eq('user_id', userId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.item_id as string);
}

// Re-derives the price and the caller's own real Bones balance
// server-side (purchase_cosmetic) — never trusts a client-submitted
// price or balance. Throws if the item isn't a shop item, is already
// owned, or the balance is too low.
export async function purchaseCosmetic(itemId: string): Promise<void> {
  const { error } = await requireClient().rpc('purchase_cosmetic', { p_item_id: itemId });
  if (error) throw new Error(error.message);
}
