import { supabase } from '../lib/supabase';

// Admin → Overview → Hound → Kennel unlocks (0216_kennel_unlocks.sql): of
// the people active in the last 30 days, how many have reached each step
// of the Kennel's ladder and how many use it.
export interface KennelUnlockRow {
  key: string;
  name: string;
  level: number;
  reached: number;
  using: number;
}

export interface KennelUnlocksOverview {
  active30d: number;
  justStarting: number;
  unlocks: KennelUnlockRow[];
}

export async function getKennelUnlocksOverview(): Promise<KennelUnlocksOverview> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { data, error } = await supabase.rpc('admin_kennel_unlocks_overview');
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(d.unlocks) ? (d.unlocks as Record<string, unknown>[]) : [];
  return {
    active30d: Number(d.active_30d ?? 0),
    justStarting: Number(d.just_starting ?? 0),
    unlocks: rows.map((r) => ({
      key: String(r.key),
      name: String(r.name),
      level: Number(r.level ?? 0),
      reached: Number(r.reached ?? 0),
      using: Number(r.using ?? 0),
    })),
  };
}

// The fold's one line.
export function kennelUnlocksSummary(o: KennelUnlocksOverview): string {
  const past = o.active30d - o.justStarting;
  return `${past} of ${o.active30d} past level 2`;
}
