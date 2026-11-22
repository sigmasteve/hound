import { supabase } from '../lib/supabase';

// The Prize Counter (0243): the Paw Coin wallet, filled when a Paw Slots
// challenge is settled, and the Kennel items it buys. Coins never become
// Bones, and these items are never sold for Bones.

function client() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

const num = (v: unknown) => Number(v ?? 0);

export interface PrizeItem {
  id: string;
  name: string;
  slot: string;
  price: number;
  owned: boolean;
}

export interface PrizeCredit {
  challengeId: string;
  name: string;
  amount: number;
  at: string;
}

export interface PrizeCounter {
  balance: number;
  earned: number;
  spent: number;
  items: PrizeItem[];
  credits: PrizeCredit[];
}

function toCounter(d: any): PrizeCounter {
  return {
    balance: num(d?.balance),
    earned: num(d?.earned),
    spent: num(d?.spent),
    items: ((d?.items ?? []) as any[]).map((i) => ({ id: String(i.id), name: String(i.name), slot: String(i.slot), price: num(i.price), owned: !!i.owned })),
    credits: ((d?.credits ?? []) as any[]).map((c) => ({ challengeId: String(c.challengeId), name: String(c.name ?? 'Paw Slots'), amount: num(c.amount), at: String(c.at ?? '') })),
  };
}

export async function getPrizeCounter(): Promise<PrizeCounter> {
  const { data, error } = await client().rpc('prize_counter_state');
  if (error) throw new Error(error.message);
  return toCounter(data);
}

export async function buyPrize(itemId: string): Promise<PrizeCounter> {
  const { data, error } = await client().rpc('prize_counter_buy', { p_item_id: itemId });
  if (error) throw new Error(error.message);
  return toCounter(data);
}

// What each one is, for the counter's cards.
export const PRIZE_NOTES: Record<string, { where: string; desc: string }> = {
  neck_lucky7: { where: 'Collar tag', desc: 'A gold tag with a lucky red 7, on a red collar.' },
  collar_goldhound: { where: 'Neck', desc: 'Navy, gold stitching and a gold paw medallion, like the jackpot hound.' },
  bowl_coin: { where: 'Yard · bowl', desc: 'A bowl stamped like a Paw Coin, always with a treat or two in it.' },
  ground_confetti: { where: 'Yard · ground', desc: 'A jackpot’s worth of gold confetti and coins on the grass.' },
  room_neon: { where: 'Room · wall', desc: 'Pink and teal neon over the bookshelf. It glows in the evening.' },
  house_arcade: { where: 'Yard · house', desc: 'A doghouse built like a slot machine: a marquee, bulbs and three Golden Hounds over the door.' },
};

// ── Admin ──

export interface PrizeCounterOverview {
  wallets: number;
  withCoins: number;
  earned: number;
  spent: number;
  balance: number;
  buyers: number;
  bought: number;
  bought7d: number;
  items: { id: string; name: string; price: number; sold: number }[];
}

export async function getPrizeCounterOverview(): Promise<PrizeCounterOverview> {
  const { data, error } = await client().rpc('admin_prize_counter_overview');
  if (error) throw new Error(error.message);
  const d: any = data ?? {};
  return {
    wallets: num(d.wallets),
    withCoins: num(d.withCoins),
    earned: num(d.earned),
    spent: num(d.spent),
    balance: num(d.balance),
    buyers: num(d.buyers),
    bought: num(d.bought),
    bought7d: num(d.bought7d),
    items: ((d.items ?? []) as any[]).map((i) => ({ id: String(i.id), name: String(i.name), price: num(i.price), sold: num(i.sold) })),
  };
}

export function prizeCounterSummary(o: PrizeCounterOverview): string {
  if (o.wallets === 0) return 'No wallets yet';
  return `${o.wallets} with a wallet · ${o.bought} ${o.bought === 1 ? 'prize' : 'prizes'} bought`;
}
