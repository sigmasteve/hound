import { supabase } from '../lib/supabase';

// Admin → Walks (0161_hound_walks.sql): who's walking with their Hound,
// how, what they find, and who opens the collection book and the diary.
export interface WalksOverview {
  walkersEver: number;
  walkers7d: number;
  walks7d: number;
  avgMinutes7d: number;
  avgSteps7d: number;
  byTime7d: { morning: number; lunchtime: number; afternoon: number; evening: number; late: number };
  findersEver: number;
  finds7d: number;
  findsByKind: { id: string; name: string; rarity: string; count: number }[];
  bookOpeners7d: number;
  diaryReaders7d: number;
  diaryShares7d: number;
}

export async function getWalksOverview(): Promise<WalksOverview> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { data, error } = await supabase.rpc('admin_walks_overview');
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as any;
  const n = (v: unknown) => Number(v ?? 0);
  return {
    walkersEver: n(d.walkers_ever),
    walkers7d: n(d.walkers_7d),
    walks7d: n(d.walks_7d),
    avgMinutes7d: n(d.avg_minutes_7d),
    avgSteps7d: n(d.avg_steps_7d),
    byTime7d: {
      morning: n(d.by_time_7d?.morning),
      lunchtime: n(d.by_time_7d?.lunchtime),
      afternoon: n(d.by_time_7d?.afternoon),
      evening: n(d.by_time_7d?.evening),
      late: n(d.by_time_7d?.late),
    },
    findersEver: n(d.finders_ever),
    finds7d: n(d.finds_7d),
    findsByKind: ((d.finds_by_kind ?? []) as any[]).map((k) => ({ id: k.id, name: k.name, rarity: k.rarity, count: n(k.count) })),
    bookOpeners7d: n(d.book_openers_7d),
    diaryReaders7d: n(d.diary_readers_7d),
    diaryShares7d: n(d.diary_shares_7d),
  };
}
