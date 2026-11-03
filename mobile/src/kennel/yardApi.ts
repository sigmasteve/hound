import { supabase } from '../lib/supabase';
import { localDayKey } from '../goals/goals';
import type { HoundEars, HoundMarkings, HoundTail } from './kennelItems';
import type { TrophyKind, YardSpot } from './yardItems';

// The Yard (0148_yard.sql). Every call throws its message on failure.

export interface YardTrophy {
  kind: TrophyKind;
  wins: number;
  lastWon: string;
}

// Someone who stopped by in the last day (your own yard only).
export interface YardVisitor {
  userId: string;
  name: string;
  pawprint: boolean;
  treat: boolean;
}

// A friend's hound over to play (0150): you both finished your goals
// today, in a challenge together.
export interface YardGuest {
  userId: string;
  owner: string;
  challenge: string;
  name: string;
  xpTotal: number;
  neckId: string | null;
  headId: string | null;
  faceId: string | null;
  coatId: string | null;
  ears: HoundEars;
  tail: HoundTail;
  markings: HoundMarkings;
  breedId: string | null;
  bodyId: string | null;
  feetId: string | null;
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
  // Friends who left a pawprint in the last day.
  pawprints: number;
  visitors: YardVisitor[];
  guest: YardGuest | null;
  // A friend's yard: what you've left there today.
  mine: { pawprint: boolean; treat: boolean } | null;
  // The Porch (0157): what's on it, or null before it's unlocked.
  porch: string[] | null;
  // The tricks this yard's hound knows (0159); empty before it's run.
  tricks: string[];
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
    // Missing before 0150 has run.
    pawprints: r?.pawprints ?? 0,
    visitors: (r?.visitors ?? []).map((v: any) => ({ userId: v.user_id, name: v.name, pawprint: !!v.pawprint, treat: !!v.treat })),
    guest: r?.guest
      ? {
          userId: r.guest.user_id,
          owner: r.guest.owner,
          challenge: r.guest.challenge,
          name: r.guest.name,
          xpTotal: r.guest.xp_total ?? 0,
          neckId: r.guest.neck_id,
          headId: r.guest.head_id,
          faceId: r.guest.face_id,
          coatId: r.guest.coat_id,
          ears: r.guest.ears ?? 'floppy',
          tail: r.guest.tail ?? 'wavy',
          markings: r.guest.markings ?? 'none',
          breedId: r.guest.breed_id ?? null,
          bodyId: r.guest.body_id ?? null,
          feetId: r.guest.feet_id ?? null,
        }
      : null,
    mine: r?.mine ? { pawprint: !!r.mine.pawprint, treat: !!r.mine.treat } : null,
    porch: Array.isArray(r?.porch) ? r.porch : null,
    tricks: Array.isArray(r?.tricks) ? r.tricks : [],
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

// Free, once a day per friend (0150).
export async function leavePawprint(friendUserId: string): Promise<void> {
  const { error } = await client().rpc('leave_pawprint', { p_friend: friendUserId, p_local_date: today() });
  if (error) throw new Error(error.message);
}

// 10 Bones; their hound's treat for the day. Returns your balance after.
export async function tossYardTreat(friendUserId: string): Promise<number> {
  const { data, error } = await client().rpc('toss_yard_treat', { p_friend: friendUserId, p_local_date: today() });
  if (error) throw new Error(error.message);
  return data as number;
}
