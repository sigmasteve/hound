import { supabase } from '../lib/supabase';
import { localDayKey } from './goals';
import { DIG_ITEMS } from '../cosmetics/catalog';

// Bone Dig (0103_bone_dig.sql): once a day, after every daily goal is
// done, dig up a free surprise. The server rolls it; every call throws
// its message on failure.

export interface BoneDigState {
  dugToday: boolean;
  // Today's find, once dug.
  prize: 'bones' | 'piece' | null;
  bones: number;
  // Pieces found in all.
  pieces: number;
}

export interface BoneDigResult {
  prize: 'bones' | 'piece';
  bones: number;
  pieces: number;
  // The Dig item this piece just completed, if any.
  unlockedItemId: string | null;
}

function client() {
  if (!supabase) throw new Error('Bone Dig needs a connection to Hound.');
  return supabase;
}

export async function getBoneDig(): Promise<BoneDigState> {
  const { data, error } = await client()
    .rpc('my_bone_dig', { p_local_date: localDayKey(new Date()) })
    .single();
  if (error) throw new Error(error.message);
  const r = data as any;
  return { dugToday: r.dug_today, prize: r.prize, bones: r.bones, pieces: r.pieces };
}

export async function digBone(): Promise<BoneDigResult> {
  const { data, error } = await client()
    .rpc('dig_bone', { p_local_date: localDayKey(new Date()) })
    .single();
  if (error) throw new Error(error.message);
  const r = data as any;
  return { prize: r.prize, bones: r.bones, pieces: r.pieces, unlockedItemId: r.unlocked_item_id };
}

// The Dig item pieces are going toward now, and how many of its pieces
// you have; null once every Dig item is found.
export function nextDigItem(pieces: number): { item: (typeof DIG_ITEMS)[number]; have: number; need: number } | null {
  let from = 0;
  for (const item of DIG_ITEMS) {
    const at = item.digPieces ?? 0;
    if (pieces < at) return { item, have: pieces - from, need: at - from };
    from = at;
  }
  return null;
}
