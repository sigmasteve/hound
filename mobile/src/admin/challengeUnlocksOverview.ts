import { supabase } from '../lib/supabase';
import type { ChallengeKind } from '../data/sampleData';

// Admin → Overview → Games → Game unlocks (0217_bones_earned_by_play.sql):
// for each locked game, how many people active in the last 30 days have
// earned enough to make one, and how many were made.
export interface ChallengeUnlockRow {
  kind: ChallengeKind;
  bones: number;
  reached: number;
  made30d: number;
}

export interface ChallengeUnlocksOverview {
  active30d: number;
  medianEarned: number;
  openAll: number;
  gates: ChallengeUnlockRow[];
}

export async function getChallengeUnlocksOverview(): Promise<ChallengeUnlocksOverview> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { data, error } = await supabase.rpc('admin_challenge_unlocks_overview');
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(d.gates) ? (d.gates as Record<string, unknown>[]) : [];
  return {
    active30d: Number(d.active_30d ?? 0),
    medianEarned: Number(d.median_earned ?? 0),
    openAll: Number(d.open_all ?? 0),
    gates: rows.map((r) => ({
      kind: String(r.kind) as ChallengeKind,
      bones: Number(r.bones ?? 0),
      reached: Number(r.reached ?? 0),
      made30d: Number(r.made_30d ?? 0),
    })),
  };
}

// The fold's one line.
export function challengeUnlocksSummary(o: ChallengeUnlocksOverview): string {
  if (o.gates.length === 0) return 'No games locked';
  return `${o.openAll} of ${o.active30d} can make every game`;
}
