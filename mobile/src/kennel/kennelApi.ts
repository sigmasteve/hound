import { supabase } from '../lib/supabase';
import { localDayKey } from '../goals/goals';
import type { HoundMood } from './HoundArt';
import type { KennelSlot } from './kennelItems';

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
