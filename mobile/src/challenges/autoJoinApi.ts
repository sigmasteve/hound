import { supabase } from '../lib/supabase';
import type { ChallengeKind } from '../data/sampleData';

// New users join the open Global Hound Challenges (0222): once per account,
// on Today's first open, up to 3 of them. The "You're in" card on Today
// lists them with Leave and Undo until Got it.

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

async function rpc<T = any>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireClient().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

const num = (v: unknown) => Number(v ?? 0);

export interface AutoJoinedChallenge {
  id: string;
  name: string;
  kind: ChallengeKind;
  startsAt: string;
  endsAt: string;
  durationDays: number;
  joined: boolean;
  field: number;
}

export interface AutoJoinCard {
  show: boolean;
  challenges: AutoJoinedChallenge[];
}

export function toAutoJoinCard(d: any): AutoJoinCard {
  return {
    show: !!d?.show,
    challenges: ((d?.challenges ?? []) as any[]).map((c) => ({
      id: c.id,
      name: c.name ?? 'A challenge',
      kind: c.kind as ChallengeKind,
      startsAt: c.starts_at,
      endsAt: c.ends_at,
      durationDays: num(c.duration_days),
      joined: !!c.joined,
      field: num(c.field),
    })),
  };
}

// Joins them, the first time only; after that it just reads the card.
export async function autoJoinOpenGlobals(): Promise<AutoJoinCard> {
  return toAutoJoinCard(await rpc('auto_join_open_globals'));
}

export async function leaveAutoJoined(challengeId: string): Promise<AutoJoinCard> {
  return toAutoJoinCard(await rpc('auto_join_leave', { p_challenge_id: challengeId }));
}

export async function rejoinAutoJoined(challengeId: string): Promise<AutoJoinCard> {
  return toAutoJoinCard(await rpc('auto_join_rejoin', { p_challenge_id: challengeId }));
}

export async function dismissAutoJoinCard(): Promise<void> {
  await rpc('auto_join_dismiss');
}

// ── Admin → Overview → Status ──

export interface AutoJoinOverview {
  new7d: number;
  people7d: number;
  joins7d: number;
  challenges7d: number;
  eligiblePlayed: number;
  played: number;
  peopleAll: number;
  leftOne: number;
  leftAll: number;
  late7d: number;
  weekLaterAuto: number | null;
  weekLaterBefore: number | null;
  byChallenge: { name: string; joined: number; left: number; played: number }[];
}

export async function getAutoJoinOverview(): Promise<AutoJoinOverview> {
  const d = await rpc<any>('admin_auto_join_overview');
  const pct = (v: unknown) => (v == null ? null : Number(v));
  return {
    new7d: num(d?.new_7d),
    people7d: num(d?.people_7d),
    joins7d: num(d?.joins_7d),
    challenges7d: num(d?.challenges_7d),
    eligiblePlayed: num(d?.eligible_played),
    played: num(d?.played),
    peopleAll: num(d?.people_all),
    leftOne: num(d?.left_one),
    leftAll: num(d?.left_all),
    late7d: num(d?.late_7d),
    weekLaterAuto: pct(d?.week_later_auto),
    weekLaterBefore: pct(d?.week_later_before),
    byChallenge: ((d?.by_challenge ?? []) as any[]).map((r) => ({ name: r.name ?? 'A challenge', joined: num(r.joined), left: num(r.left), played: num(r.played) })),
  };
}

export function playedPct(o: AutoJoinOverview): string {
  return o.eligiblePlayed > 0 ? `${Math.round((o.played / o.eligiblePlayed) * 100)}%` : '–';
}

export function autoJoinSummary(o: AutoJoinOverview): string {
  if (o.peopleAll === 0) return 'Nobody auto-joined yet';
  return `${o.people7d.toLocaleString()} auto-joined this week · ${playedPct(o)} played within 3 days`;
}
