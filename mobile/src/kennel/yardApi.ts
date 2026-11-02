import { supabase } from '../lib/supabase';
import { localDayKey } from '../goals/goals';
import type { TrophyKind, YardSpot } from './yardItems';

// The Yard (0148_yard.sql). Every call throws its message on failure.

export interface YardTrophy {
  kind: TrophyKind;
  wins: number;
  lastWon: string;
}

export interface Yard {
  // 0 (Pup) to 4 (Legend): see YARD_SIZES.
  size: number;
  // Only the spots this yard has, each with its item (or the free one).
  spots: Partial<Record<YardSpot, string>>;
  // Every kind won, newest first.
  trophies: YardTrophy[];
  // The ones standing in the yard, in order.
  shown: TrophyKind[];
}

function client() {
  if (!supabase) throw new Error('The Yard needs a connection to Hound.');
  return supabase;
}

const today = () => localDayKey(new Date());

function toYard(r: any): Yard {
  return {
    size: r?.size ?? 0,
    spots: r?.spots ?? {},
    trophies: (r?.trophies ?? []).map((t: any) => ({ kind: t.kind, wins: t.wins, lastWon: t.last_won })),
    shown: r?.shown ?? [],
  };
}

export async function getYard(): Promise<Yard> {
  const { data, error } = await client().rpc('my_yard', { p_local_date: today() });
  if (error) throw new Error(error.message);
  return toYard(data);
}

export async function getFriendYard(friendUserId: string): Promise<Yard> {
  const { data, error } = await client().rpc('friend_yard', { p_friend: friendUserId, p_local_date: today() });
  if (error) throw new Error(error.message);
  return toYard(data);
}

// null puts the spot's free item back.
export async function placeYardItem(spot: YardSpot, itemId: string | null): Promise<void> {
  const { error } = await client().rpc('place_yard_item', { p_local_date: today(), p_spot: spot, p_item_id: itemId });
  if (error) throw new Error(error.message);
}

// null goes back to newest wins first.
export async function setYardTrophies(kinds: TrophyKind[] | null): Promise<void> {
  const { error } = await client().rpc('set_yard_trophies', { p_local_date: today(), p_kinds: kinds });
  if (error) throw new Error(error.message);
}
