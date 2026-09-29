import { supabase } from '../lib/supabase';
import type { BingoCardType, ChallengeKind, DistanceGoalUnit } from './types';

// Global Hound Challenges — see 0075_global_challenges.sql. An admin
// publishes one to everyone; anyone signed in joins it from Today until
// its join window closes. Once joined it's an ordinary challenge
// (leaderboard, sync, settlement), so this file only covers what's
// different: publishing, listing, and joining.

// The kinds that work with an open-ended crowd — the same list
// publish_global_challenge enforces server-side. Chase, Tag, and
// Tic-Tac-Go all depend on a small, known group.
export const GLOBAL_KINDS: ChallengeKind[] = ['steps', 'streak', 'distance', 'bingo', 'seventyfive'];

// How long after the start people can still join. 'start' closes
// joining the moment it begins (only offered for a future start); 'end'
// leaves it open the whole way through.
export type JoinWindow = 'start' | '1' | '3' | '7' | 'end';

export const JOIN_WINDOW_LABEL: Record<JoinWindow, string> = {
  start: 'At start',
  '1': '+1 day',
  '3': '+3 days',
  '7': '+1 week',
  end: 'Anytime',
};

export interface GlobalTemplate {
  id: string;
  name: string;
  kind: ChallengeKind;
  durationDays: number;
  blurb: string;
  joinWindow: JoinWindow;
  dailyGoalSteps?: number;
  distanceGoalUnit?: DistanceGoalUnit;
  distanceGoalMi?: number;
  distanceGoalSteps?: number;
  bingoCardType?: BingoCardType;
}

// Starting points on the admin's publish screen — every field stays
// editable afterward.
export const GLOBAL_TEMPLATES: GlobalTemplate[] = [
  {
    id: 'weekly-step-off',
    name: 'Weekly Step-Off',
    kind: 'steps',
    durationDays: 7,
    blurb: 'A week-long Step Race — most steps wins.',
    joinWindow: '1',
  },
  {
    id: 'ten-k-a-day',
    name: '10K a Day',
    kind: 'streak',
    durationDays: 7,
    blurb: 'Hit 10,000 steps every day for a week.',
    joinWindow: '1',
    dailyGoalSteps: 10_000,
  },
  {
    id: 'around-the-world',
    name: 'Walk Around the World',
    kind: 'distance',
    durationDays: 30,
    blurb: 'Everyone’s miles add up to 24,901 — the distance around the Earth.',
    joinWindow: 'end',
    distanceGoalUnit: 'miles',
    distanceGoalMi: 24_901,
  },
  {
    id: 'bingo-month',
    name: 'Workout Bingo Month',
    kind: 'bingo',
    durationDays: 30,
    blurb: 'Fill a Variety Bingo card over a month.',
    joinWindow: '7',
    bingoCardType: 'variety',
  },
  {
    id: 'seventy-five',
    name: '75 Day Hound Challenge',
    kind: 'seventyfive',
    durationDays: 75,
    blurb: 'The daily 75 Day checklist, together.',
    joinWindow: '3',
  },
];

// Local midnight `daysFromToday` days out — a global challenge always
// starts at the start of a day, so a whole day's steps count.
export function globalStartDate(daysFromToday: number, now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + daysFromToday);
  return d;
}

export function joinClosesAt(startsAt: Date, durationDays: number, window: JoinWindow): Date {
  const endsAt = new Date(startsAt.getTime() + durationDays * 86_400_000);
  if (window === 'end') return endsAt;
  if (window === 'start') return startsAt;
  const closes = new Date(startsAt.getTime() + Number(window) * 86_400_000);
  return closes < endsAt ? closes : endsAt;
}

export function startsLabel(daysFromToday: number, now: Date = new Date()): string {
  if (daysFromToday === 0) return 'Today';
  if (daysFromToday === 1) return 'Tomorrow';
  return globalStartDate(daysFromToday, now).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export interface GlobalChallenge {
  id: string;
  name: string;
  kind: ChallengeKind;
  durationDays: number;
  startsAt: string;
  endsAt: string;
  joinClosesAt: string;
  createdAt: string;
  dailyGoalSteps: number | null;
  distanceGoalUnit: DistanceGoalUnit | null;
  distanceGoalMi: number | null;
  distanceGoalSteps: number | null;
  bingoCardType: BingoCardType | null;
  participantCount: number;
  joined: boolean;
}

export function canJoin(c: GlobalChallenge, now: number = Date.now()): boolean {
  return !c.joined && now < new Date(c.joinClosesAt).getTime() && now < new Date(c.endsAt).getTime();
}

function dayCountLabel(ms: number): string {
  const days = Math.ceil(ms / 86_400_000);
  if (days <= 1) {
    const hours = Math.max(1, Math.ceil(ms / 3_600_000));
    return hours >= 24 ? '1 day' : `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  return `${days} days`;
}

// One short line under a challenge's name: where it is in its run.
export function globalTimingLine(c: GlobalChallenge, now: number = Date.now()): string {
  const starts = new Date(c.startsAt).getTime();
  const ends = new Date(c.endsAt).getTime();
  if (now >= ends) return 'Ended';
  if (now < starts) return `Starts in ${dayCountLabel(starts - now)}`;
  return `${dayCountLabel(ends - now)} left`;
}

// When joining closes, for a card that can still be joined — null once
// it can't, or when it stays open until the challenge ends anyway.
export function joinDeadlineLine(c: GlobalChallenge, now: number = Date.now()): string | null {
  const closes = new Date(c.joinClosesAt).getTime();
  if (now >= closes || closes >= new Date(c.endsAt).getTime()) return null;
  return `Joining closes in ${dayCountLabel(closes - now)}`;
}

function rowToGlobal(r: any): GlobalChallenge {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    durationDays: r.duration_days,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    joinClosesAt: r.join_closes_at,
    createdAt: r.created_at,
    dailyGoalSteps: r.daily_goal_steps,
    distanceGoalUnit: r.distance_goal_unit,
    distanceGoalMi: r.distance_goal_mi == null ? null : Number(r.distance_goal_mi),
    distanceGoalSteps: r.distance_goal_steps,
    bingoCardType: r.bingo_card_type,
    participantCount: r.participant_count ?? 0,
    joined: !!r.joined,
  };
}

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

// Running and upcoming ones for Today; with includeEnded, everything
// (newest first) for the admin's list.
export async function listGlobalChallenges(includeEnded = false): Promise<GlobalChallenge[]> {
  const { data, error } = await requireClient().rpc('list_global_challenges', { p_include_ended: includeEnded });
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map(rowToGlobal);
}

export async function joinGlobalChallenge(challengeId: string): Promise<void> {
  const { error } = await requireClient().rpc('join_global_challenge', { p_challenge_id: challengeId });
  if (error) throw new Error(error.message);
}

export interface PublishGlobalInput {
  name: string;
  kind: ChallengeKind;
  durationDays: number;
  startsAt: Date;
  joinClosesAt: Date;
  dailyGoalSteps?: number;
  distanceGoalUnit?: DistanceGoalUnit;
  distanceGoalMi?: number;
  distanceGoalSteps?: number;
  bingoCardType?: BingoCardType;
}

export async function publishGlobalChallenge(input: PublishGlobalInput): Promise<string> {
  const { data, error } = await requireClient().rpc('publish_global_challenge', {
    p_name: input.name,
    p_kind: input.kind,
    p_duration_days: input.durationDays,
    p_starts_at: input.startsAt.toISOString(),
    p_join_closes_at: input.joinClosesAt.toISOString(),
    p_daily_goal_steps: input.dailyGoalSteps ?? null,
    p_distance_goal_unit: input.distanceGoalUnit ?? null,
    p_distance_goal_mi: input.distanceGoalMi ?? null,
    p_distance_goal_steps: input.distanceGoalSteps ?? null,
    p_bingo_card_type: input.bingoCardType ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

// Takes it down for everyone, progress included (the same cascade as
// deleting any challenge).
export async function deleteGlobalChallenge(challengeId: string): Promise<void> {
  const { error } = await requireClient().from('challenges').delete().eq('id', challengeId);
  if (error) throw new Error(error.message);
}

// Read on its own rather than added to supabaseChallenges' shared column
// list, so every other challenge read keeps working even before
// 0075_global_challenges.sql has run — this just reads false then.
export async function isGlobalChallenge(challengeId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.from('challenges').select('is_global').eq('id', challengeId).maybeSingle();
  if (error || !data) return false;
  return !!(data as { is_global?: boolean }).is_global;
}
