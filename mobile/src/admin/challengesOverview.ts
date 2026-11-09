import { supabase } from '../lib/supabase';
import type { ChallengeKind } from '../challenges/types';

// Admin → Challenges (0180): how many challenges are running, of which
// kinds, who made them, and how many are made week to week.
export type ChallengeSource = 'friends' | 'community' | 'global';

export interface ChallengesOverview {
  running: number;
  upcoming: number;
  finished30d: number;
  all: number;
  created7d: number;
  created30d: number;
  creators30d: number;
  peopleRunning: number;
  avgPeopleRunning: number;
  bySource: Record<ChallengeSource, { running: number; created30d: number; all: number }>;
  // Every kind, most made this month first.
  byKind: { kind: ChallengeKind; running: number; upcoming: number; created30d: number; allTime: number; peopleRunning: number }[];
  // The last 8 weeks, oldest first.
  weekly: { week: string; created: number }[];
  // 0182: Tag and Chase games by scene, all time.
  scenes: Record<string, Record<string, number>>;
}

export async function getChallengesOverview(): Promise<ChallengesOverview> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { data, error } = await supabase.rpc('admin_challenges_overview');
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as any;
  const n = (v: unknown) => Number(v ?? 0);
  const src = (s: any) => ({ running: n(s?.running), created30d: n(s?.created_30d), all: n(s?.all) });
  return {
    running: n(d.running),
    upcoming: n(d.upcoming),
    finished30d: n(d.finished_30d),
    all: n(d.all),
    created7d: n(d.created_7d),
    created30d: n(d.created_30d),
    creators30d: n(d.creators_30d),
    peopleRunning: n(d.people_running),
    avgPeopleRunning: n(d.avg_people_running),
    bySource: { friends: src(d.by_source?.friends), community: src(d.by_source?.community), global: src(d.by_source?.global) },
    byKind: ((d.by_kind ?? []) as any[]).map((k) => ({
      kind: k.kind as ChallengeKind,
      running: n(k.running),
      upcoming: n(k.upcoming),
      created30d: n(k.created_30d),
      allTime: n(k.all_time),
      peopleRunning: n(k.people_running),
    })),
    weekly: ((d.weekly ?? []) as any[]).map((w) => ({ week: String(w.week), created: n(w.created) })),
    scenes: Object.fromEntries(
      Object.entries((d.scenes ?? {}) as Record<string, Record<string, unknown>>).map(([kind, m]) => [
        kind,
        Object.fromEntries(Object.entries(m ?? {}).map(([k, v]) => [k, n(v)])),
      ]),
    ),
  };
}
