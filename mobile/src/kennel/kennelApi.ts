import { supabase } from '../lib/supabase';
import { localDayKey } from '../goals/goals';
import type { HoundMood } from './HoundArt';
import type { HoundEars, HoundMarkings, HoundTail, KennelSlot } from './kennelItems';

// The Kennel (0104_kennel.sql). The server works out the mood and checks
// every purchase; every call throws its message on failure.

export type CareMode = 'gentle' | 'classic';

export interface Kennel {
  name: string;
  careMode: CareMode;
  mood: HoundMood;
  goalDays7: number;
  goalDayToday: boolean;
  treatedToday: boolean;
  // Classic care only.
  hearts: number | null;
  neckId: string | null;
  headId: string | null;
  faceId: string | null;
  coatId: string | null;
  ears: HoundEars;
  tail: HoundTail;
  markings: HoundMarkings;
  owned: string[];
  xpTotal: number;
  bonesBalance: number;
}

function client() {
  if (!supabase) throw new Error('The Kennel needs a connection to Hound.');
  return supabase;
}

const today = () => localDayKey(new Date());

export async function getKennel(): Promise<Kennel> {
  const { data, error } = await client().rpc('my_kennel', { p_local_date: today() }).single();
  if (error) throw new Error(error.message);
  const r = data as any;
  return {
    name: r.name,
    careMode: r.care_mode,
    mood: r.mood,
    goalDays7: r.goal_days_7,
    goalDayToday: r.goal_day_today,
    treatedToday: r.treated_today,
    hearts: r.hearts,
    neckId: r.neck_id,
    headId: r.head_id,
    faceId: r.face_id,
    // Missing before 0105 has run: the default look.
    coatId: r.coat_id ?? null,
    ears: r.ears ?? 'floppy',
    tail: r.tail ?? 'wavy',
    markings: r.markings ?? 'none',
    owned: r.owned ?? [],
    xpTotal: r.xp_total ?? 0,
    bonesBalance: r.bones_balance ?? 0,
  };
}

// Either may be null to leave it as it is.
export async function setKennel(name: string | null, careMode: CareMode | null): Promise<void> {
  const { error } = await client().rpc('set_kennel', { p_local_date: today(), p_name: name, p_care_mode: careMode });
  if (error) throw new Error(error.message);
}

// Any of them null leaves it as it is. Free.
export async function setKennelLook(look: { ears?: HoundEars; tail?: HoundTail; markings?: HoundMarkings }): Promise<void> {
  const { error } = await client().rpc('set_kennel_look', {
    p_local_date: today(),
    p_ears: look.ears ?? null,
    p_tail: look.tail ?? null,
    p_markings: look.markings ?? null,
  });
  if (error) throw new Error(error.message);
}

// A friend's hound, for their friend page.
export interface FriendKennel {
  name: string;
  mood: Kennel['mood'];
  neckId: string | null;
  headId: string | null;
  faceId: string | null;
  coatId: string | null;
  ears: HoundEars;
  tail: HoundTail;
  markings: HoundMarkings;
  xpTotal: number;
}

export async function getFriendKennel(friendUserId: string): Promise<FriendKennel> {
  const { data, error } = await client().rpc('friend_kennel', { p_friend: friendUserId, p_local_date: today() }).single();
  if (error) throw new Error(error.message);
  const r = data as any;
  return {
    name: r.name,
    mood: r.mood,
    neckId: r.neck_id,
    headId: r.head_id,
    faceId: r.face_id,
    coatId: r.coat_id,
    ears: r.ears,
    tail: r.tail,
    markings: r.markings,
    xpTotal: r.xp_total ?? 0,
  };
}

// How a friend's hound is doing, for their page.
export function friendMoodLine(name: string, mood: Kennel['mood']): string {
  switch (mood) {
    case 'hungry':
      return `${name} is hungry.`;
    case 'happy':
      return `${name} is happy: their goals are getting done.`;
    case 'okay':
      return `${name} is doing okay.`;
    default:
      return `${name} is sleepy. Maybe give them a nudge?`;
  }
}

// Your hound as your avatar everywhere (0106_hound_avatar.sql), or back
// to initials. Returns the avatar's new icon id.
export async function setHoundAvatar(on: boolean): Promise<string | null> {
  const { data, error } = await client().rpc('use_hound_avatar', { p_local_date: today(), p_on: on });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

export async function giveTreat(): Promise<void> {
  const { error } = await client().rpc('give_treat', { p_local_date: today() });
  if (error) throw new Error(error.message);
}

export async function buyKennelItem(itemId: string): Promise<void> {
  const { error } = await client().rpc('buy_kennel_item', { p_local_date: today(), p_item_id: itemId });
  if (error) throw new Error(error.message);
}

export async function equipKennelItem(slot: KennelSlot, itemId: string | null): Promise<void> {
  const { error } = await client().rpc('equip_kennel_item', { p_local_date: today(), p_slot: slot, p_item_id: itemId });
  if (error) throw new Error(error.message);
}

// One line on how the hound is doing, and why.
export function moodLine(k: Kennel): string {
  switch (k.mood) {
    case 'hungry':
      return `${k.name} is hungry. A meal fills a heart.`;
    case 'happy':
      return k.goalDayToday ? `${k.name} is happy: every goal done today.` : `${k.name} is happy: ${k.goalDays7} goal days this week.`;
    case 'okay':
      return `${k.name} is doing okay. Finish today's goals to cheer them up.`;
    default:
      return `${k.name} is sleepy. Hit your goals to wake them up.`;
  }
}
