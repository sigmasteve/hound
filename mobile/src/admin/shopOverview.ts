import { supabase } from '../lib/supabase';

// Admin → Shop (0156_shop_phase1.sql): packs sold and what they brought
// in at list prices, who buys, and where Bones get spent.
export interface ShopOverview {
  revenue7d: number;
  revenue30d: number;
  revenueAll: number;
  buyers30d: number;
  buyersAll: number;
  firstBuyers30d: number;
  packs30d: { small: number; medium: number; large: number };
  spent30d: { clothes: number; coatsBreeds: number; yard: number; limited: number };
  topItems30d: { name: string; sold: number; bones: number }[];
  wearingBody: number;
  wearingFeet: number;
  clothesBuyers: number;
  // 0157.
  porchUnlocks: number;
  hotTubs: number;
  bougieHouses: number;
  gifts30d: number;
  giftBones30d: number;
  gifters30d: number;
  // 0158.
  tricksBought: number;
  trickOwners: number;
}

export async function getShopOverview(): Promise<ShopOverview> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { data, error } = await supabase.rpc('admin_shop_overview');
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as any;
  const n = (v: unknown) => Number(v ?? 0);
  return {
    revenue7d: n(d.revenue_7d),
    revenue30d: n(d.revenue_30d),
    revenueAll: n(d.revenue_all),
    buyers30d: n(d.buyers_30d),
    buyersAll: n(d.buyers_all),
    firstBuyers30d: n(d.first_buyers_30d),
    packs30d: { small: n(d.packs_30d?.small), medium: n(d.packs_30d?.medium), large: n(d.packs_30d?.large) },
    spent30d: {
      clothes: n(d.spent_30d?.clothes),
      coatsBreeds: n(d.spent_30d?.coats_breeds),
      yard: n(d.spent_30d?.yard),
      limited: n(d.spent_30d?.limited),
    },
    topItems30d: ((d.top_items_30d ?? []) as any[]).map((t) => ({ name: t.name, sold: n(t.sold), bones: n(t.bones) })),
    wearingBody: n(d.wearing_body),
    wearingFeet: n(d.wearing_feet),
    clothesBuyers: n(d.clothes_buyers),
    porchUnlocks: n(d.porch_unlocks),
    hotTubs: n(d.hot_tubs),
    bougieHouses: n(d.bougie_houses),
    gifts30d: n(d.gifts_30d),
    giftBones30d: n(d.gift_bones_30d),
    gifters30d: n(d.gifters_30d),
    tricksBought: n(d.tricks_bought),
    trickOwners: n(d.trick_owners),
  };
}

export function dollars(v: number): string {
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
