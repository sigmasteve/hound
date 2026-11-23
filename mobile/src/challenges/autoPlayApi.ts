import { supabase } from '../lib/supabase';

// Auto (0256), for Admin: how much of the ring (Hound Bout, Title Bout)
// and of Paw Slots is played on Auto, this week and ever.
export interface AutoPlayOverview {
  ringAuto7d: number;
  ringAll7d: number;
  ringAutoPeople7d: number;
  ringAutoPeopleEver: number;
  slotsAuto7d: number;
  slotsAll7d: number;
  slotsAutoPeople7d: number;
  slotsAutoPeopleEver: number;
  // 0257
  derbyAuto7d: number;
  derbyAll7d: number;
  derbyAutoPeople7d: number;
  derbyAutoPeopleEver: number;
  shootoutAuto7d: number;
  shootoutAll7d: number;
  shootoutAutoPeople7d: number;
  shootoutAutoPeopleEver: number;
  defendAuto7d: number;
  defendAll7d: number;
  defendAutoPeople7d: number;
}

export async function getAutoPlayOverview(): Promise<AutoPlayOverview | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('admin_auto_play_overview');
  // Before 0256 is run: no numbers rather than an error on the card.
  if (error || !data) return null;
  const d = data as Record<string, unknown>;
  const n = (k: string) => Number(d[k] ?? 0);
  return {
    ringAuto7d: n('ring_auto_7d'),
    ringAll7d: n('ring_all_7d'),
    ringAutoPeople7d: n('ring_auto_people_7d'),
    ringAutoPeopleEver: n('ring_auto_people_ever'),
    slotsAuto7d: n('slots_auto_7d'),
    slotsAll7d: n('slots_all_7d'),
    slotsAutoPeople7d: n('slots_auto_people_7d'),
    slotsAutoPeopleEver: n('slots_auto_people_ever'),
    derbyAuto7d: n('derby_auto_7d'),
    derbyAll7d: n('derby_all_7d'),
    derbyAutoPeople7d: n('derby_auto_people_7d'),
    derbyAutoPeopleEver: n('derby_auto_people_ever'),
    shootoutAuto7d: n('shootout_auto_7d'),
    shootoutAll7d: n('shootout_all_7d'),
    shootoutAutoPeople7d: n('shootout_auto_people_7d'),
    shootoutAutoPeopleEver: n('shootout_auto_people_ever'),
    defendAuto7d: n('defend_auto_7d'),
    defendAll7d: n('defend_all_7d'),
    defendAutoPeople7d: n('defend_auto_people_7d'),
  };
}

export const autoShare = (part: number, all: number) => (all > 0 ? `${Math.round((100 * part) / all)}%` : '–');
