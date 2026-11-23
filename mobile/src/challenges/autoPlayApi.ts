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
  };
}

export const autoShare = (part: number, all: number) => (all > 0 ? `${Math.round((100 * part) / all)}%` : '–');
