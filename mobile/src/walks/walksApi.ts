import { supabase } from '../lib/supabase';
import type { FindKind, HoundWalk, Season, SpottedWalk, WalksData } from './walks';

// 0161_hound_walks.sql: save the phone's walks for a day, read the last
// 7 days and the collection, and count collection book and diary opens.

function parse(d: any): WalksData {
  const walks: HoundWalk[] = ((d?.walks ?? []) as any[]).map((w) => ({
    id: w.id,
    day: w.day,
    startMinute: Number(w.start_minute ?? 0),
    startedAt: new Date(w.started_at),
    endedAt: new Date(w.ended_at),
    steps: Number(w.steps ?? 0),
    distanceM: w.distance_m == null ? null : Number(w.distance_m),
    findId: w.find_id ?? null,
    walking: !!w.walking,
  }));
  const found = new Map<string, { count: number; firstAt: Date | null }>();
  for (const f of (d?.finds ?? []) as any[]) {
    found.set(f.id, { count: Number(f.count ?? 0), firstAt: f.first_at ? new Date(f.first_at) : null });
  }
  const kinds: FindKind[] = ((d?.kinds ?? []) as any[]).map((k) => ({
    id: k.id,
    name: k.name,
    rarity: k.rarity,
    season: k.season ?? null,
  }));
  const stepsByDay = new Map<string, number>();
  for (const s of (d?.steps_by_day ?? []) as any[]) stepsByDay.set(s.day, Number(s.steps ?? 0));
  return { walks, found, kinds, season: (d?.season ?? 'autumn') as Season, stepsByDay };
}

export async function getWalks(day: string): Promise<WalksData> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { data, error } = await supabase.rpc('my_walks', { p_day: day });
  if (error) throw new Error(error.message);
  return parse(data);
}

export async function saveWalks(day: string, walks: SpottedWalk[]): Promise<WalksData> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { data, error } = await supabase.rpc('save_hound_walks', {
    p_day: day,
    p_walks: walks.map((w) => ({
      start: w.start.toISOString(),
      end: w.end.toISOString(),
      start_minute: w.startMinute,
      steps: w.steps,
      distance_m: w.distanceM,
    })),
  });
  if (error) throw new Error(error.message);
  return parse(data);
}

export type WalkEvent = 'book_open' | 'diary_open' | 'diary_share';

// Counted once a day per person, for Admin. Never in the way.
export function logWalkEvent(kind: WalkEvent): void {
  if (!supabase) return;
  supabase.rpc('log_walk_event', { p_kind: kind }).then(
    () => {},
    () => {},
  );
}
