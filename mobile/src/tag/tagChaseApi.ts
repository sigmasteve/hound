import { supabase } from '../lib/supabase';
import { parseHoundAvatar } from '../kennel/houndAvatar';
import type { TagHound } from './TagChase';

// Game of Tag, the daily chase (0181): the game as tag_chase_view gives
// it, which settles any day that's over first.

export interface ChasePlayer {
  id: string;
  name: string;
  hound: TagHound;
}

export interface ChaseDay {
  dayNo: number;
  day: string;
  it: string;
  headStart: number;
  steps: Record<string, number>;
  tagged: { user: string; margin: number }[];
  escaped: { user: string; margin: number }[];
  nextIt: string;
  // 0186: nobody was tagged and IT walked under 1,000 steps, so IT
  // passed to the closest call.
  passed: boolean;
}

export interface ChaseStanding {
  user: string;
  tags: number;
  escapes: number;
  daysIt: number;
  points: number;
}

export interface TagChase {
  headStart: number;
  days: number;
  firstDay: string;
  // Who's IT now; null before the game starts.
  it: string | null;
  players: ChasePlayer[];
  // Today's steps so far, by player.
  today: Record<string, number>;
  history: ChaseDay[];
  standings: ChaseStanding[];
}

// A Kennel hound code, as HoundArt draws it (avatars ignore the rank).
export function houndFromCode(code: string | null | undefined): TagHound {
  const look = parseHoundAvatar(code);
  return look
    ? {
        rank: 'hunter',
        coatId: look.coatId,
        ears: look.ears,
        tail: look.tail,
        markings: look.markings,
        headId: look.headId,
        faceId: look.faceId,
        breedId: look.breedId,
      }
    : { rank: 'hunter' };
}

const numMap = (m: any): Record<string, number> =>
  Object.fromEntries(Object.entries(m ?? {}).map(([k, v]) => [k, Number(v ?? 0)]));

export async function getTagChase(challengeId: string, day: string): Promise<TagChase> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { data, error } = await supabase.rpc('tag_chase_view', { p_challenge_id: challengeId, p_day: day });
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as any;
  return {
    headStart: Number(d.head_start ?? 2000),
    days: Number(d.days ?? 7),
    firstDay: String(d.first_day ?? ''),
    it: d.it ?? null,
    players: ((d.players ?? []) as any[]).map((p) => ({ id: p.id, name: p.name ?? 'Someone', hound: houndFromCode(p.hound) })),
    today: numMap(d.today),
    history: ((d.history ?? []) as any[]).map((h) => ({
      dayNo: Number(h.day_no),
      day: String(h.day),
      it: h.it,
      headStart: Number(h.head_start ?? 2000),
      steps: numMap(h.steps),
      tagged: ((h.tagged ?? []) as any[]).map((t) => ({ user: t.user, margin: Number(t.margin) })),
      escaped: ((h.escaped ?? []) as any[]).map((t) => ({ user: t.user, margin: Number(t.margin) })),
      nextIt: h.next_it,
      passed: !!h.passed,
    })),
    standings: ((d.standings ?? []) as any[]).map((s) => ({
      user: s.user,
      tags: Number(s.tags ?? 0),
      escapes: Number(s.escapes ?? 0),
      daysIt: Number(s.days_it ?? 0),
      points: Number(s.points ?? 0),
    })),
  };
}

// Admin → Overview → Tag (0181).
export interface TagOverview {
  running: number;
  upcoming: number;
  finished: number;
  players: number;
  oldRunning: number;
  days7d: number;
  tags7d: number;
  escapes7d: number;
  noTagDays7d: number;
  headStarts: Record<string, number>;
}

export async function getTagOverview(): Promise<TagOverview> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { data, error } = await supabase.rpc('admin_tag_overview');
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as any;
  const n = (v: unknown) => Number(v ?? 0);
  return {
    running: n(d.running),
    upcoming: n(d.upcoming),
    finished: n(d.finished),
    players: n(d.players),
    oldRunning: n(d.old_running),
    days7d: n(d.days_7d),
    tags7d: n(d.tags_7d),
    escapes7d: n(d.escapes_7d),
    noTagDays7d: n(d.no_tag_days_7d),
    headStarts: numMap(d.head_starts),
  };
}
