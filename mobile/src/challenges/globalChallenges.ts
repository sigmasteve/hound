import { supabase } from '../lib/supabase';
import type { BingoCardType, ChallengeKind, DistanceGoalUnit, DistanceSource } from './types';

// Global Hound Challenges — see 0075_global_challenges.sql. An admin
// publishes one to everyone; anyone signed in joins it from Today until
// its join window closes. Once joined it's an ordinary challenge
// (leaderboard, sync, settlement), so this file only covers what's
// different: publishing, listing, and joining.

// The kinds that work with an open-ended crowd — the same list
// publish_global_challenge enforces server-side. Chase, Tag, and
// Tic-Tac-Go all depend on a small, known group.
export const GLOBAL_KINDS: ChallengeKind[] = ['steps', 'streak', 'distance', 'bingo', 'seventyfive', 'journey', 'checklist'];

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
  // A miles pool: what counts (Challenge.distanceSource).
  distanceSource?: DistanceSource;
  bingoCardType?: BingoCardType;
  // A Journey's course (src/journeys/courses.ts).
  courseId?: string;
  // Seasonal ones are listed under their own heading; the blurb says
  // when to start them (the publish screen picks the actual day).
  seasonal?: boolean;
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
    blurb: 'A 5×5 HOUND card over a month. First BINGO wins.',
    joinWindow: '7',
    bingoCardType: 'hound',
  },
  {
    id: 'seventy-five',
    name: '75 Day Hound Challenge',
    kind: 'seventyfive',
    durationDays: 75,
    blurb: 'The daily 75 Day checklist, together.',
    joinWindow: '3',
  },
  {
    id: 'daily-accountability',
    name: 'Daily Accountability',
    kind: 'checklist',
    durationDays: 30,
    blurb: 'A short daily list for everyone: a workout, a few thousand steps, a quiet minute. Tick it all or the day doesn’t count.',
    joinWindow: '7',
  },
  {
    id: 'windy-city-journey',
    name: 'Windy City 26.2, Together',
    kind: 'journey',
    durationDays: 30,
    blurb: 'Everyone walks the Chicago course from the same start. First to the finish wins.',
    joinWindow: '3',
    courseId: 'windy-city',
  },
  {
    id: 'golden-gate-journey',
    name: 'Golden Gate Weekend',
    kind: 'journey',
    durationDays: 3,
    blurb: 'Across the Golden Gate Bridge, 1.7 miles. A quick one everyone can finish.',
    joinWindow: '1',
    courseId: 'golden-gate',
  },
  {
    id: 'appalachian-trail',
    name: 'Hike the Appalachian Trail',
    kind: 'distance',
    durationDays: 30,
    blurb: 'Every mile anyone walks adds up to the 2,190-mile trail from Georgia to Maine.',
    joinWindow: 'end',
    distanceGoalUnit: 'miles',
    distanceGoalMi: 2_190,
    distanceSource: 'all',
  },
  {
    id: 'route-66',
    name: 'Route 66',
    kind: 'distance',
    durationDays: 21,
    blurb: 'Chicago to Santa Monica together: 2,448 miles.',
    joinWindow: 'end',
    distanceGoalUnit: 'miles',
    distanceGoalMi: 2_448,
  },
  {
    id: 'million-step-march',
    name: 'Million Step March',
    kind: 'distance',
    durationDays: 14,
    blurb: 'A million steps between everyone.',
    joinWindow: 'end',
    distanceGoalUnit: 'steps',
    distanceGoalSteps: 1_000_000,
  },
  {
    id: 'weekend-warrior',
    name: 'Weekend Warrior',
    kind: 'steps',
    durationDays: 2,
    blurb: 'A Saturday-and-Sunday Step Race. Start it on a Saturday.',
    joinWindow: 'end',
  },
  {
    id: 'monster-mash',
    name: 'Monster Mash Week',
    kind: 'steps',
    durationDays: 7,
    blurb: 'A Step Race that ends on Halloween. Start it Oct 25.',
    joinWindow: '1',
    seasonal: true,
  },
  {
    id: 'turkey-trot',
    name: 'Turkey Trot Week',
    kind: 'steps',
    durationDays: 7,
    blurb: 'A Step Race around Thanksgiving. Start it the Saturday before.',
    joinWindow: '1',
    seasonal: true,
  },
  {
    id: 'burn-the-pie',
    name: 'Burn the Pie',
    kind: 'streak',
    durationDays: 7,
    blurb: '8,000 steps every day from Thanksgiving on.',
    joinWindow: '1',
    dailyGoalSteps: 8_000,
    seasonal: true,
  },
  {
    id: 'twelve-days',
    name: '12 Days of Steps',
    kind: 'streak',
    durationDays: 12,
    blurb: '10,000 steps a day for the 12 days before Christmas. Start it Dec 13.',
    joinWindow: '1',
    dailyGoalSteps: 10_000,
    seasonal: true,
  },
  {
    id: 'holiday-bingo',
    name: 'Holiday Bingo',
    kind: 'bingo',
    durationDays: 14,
    blurb: 'A 4×4 HUNT card through the holidays. Start it mid-December.',
    joinWindow: '3',
    bingoCardType: 'hound',
    seasonal: true,
  },
  {
    id: 'new-year-new-hound',
    name: 'New Year, New Hound',
    kind: 'bingo',
    durationDays: 21,
    blurb: 'A 5×5 HOUND card to start the year. Start it Jan 1.',
    joinWindow: '7',
    bingoCardType: 'hound',
    seasonal: true,
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
  // A Journey's course; null for every other kind (and before 0122).
  courseId: string | null;
  // A miles pool: what counts; null for workouts (and before 0130).
  distanceSource: DistanceSource | null;
  participantCount: number;
  // Bones for 1st, 2nd and 3rd (0107_challenge_pot.sql), or null for none.
  prizes: [number, number, number] | null;
  // Who sponsors it (0111_sponsored_challenges.sql), or null.
  sponsor: ChallengeSponsor | null;
  joined: boolean;
}

export interface ChallengeSponsor {
  name: string;
  // One line, often a real prize ("Winner gets a $50 gift card").
  message: string | null;
  // Their site, opened when someone taps the sponsor line.
  url: string | null;
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
    courseId: r.course_id ?? null,
    distanceSource: r.distance_source ?? null,
    participantCount: r.participant_count ?? 0,
    prizes: null,
    sponsor: null,
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
  const list = ((data ?? []) as any[]).map(rowToGlobal);
  if (list.length === 0) return list;
  // Their prizes, read alongside (anyone signed in can read a global
  // challenge's row). Missing before 0107 has run: no prizes shown.
  const { data: prizeRows } = await requireClient()
    .from('challenges')
    .select('id, prize_bones')
    .in(
      'id',
      list.map((c) => c.id),
    );
  const prizes = new Map(((prizeRows ?? []) as { id: string; prize_bones: number[] | null }[]).map((r) => [r.id, r.prize_bones]));
  // And their sponsors, in a read of their own so the prizes still show
  // before 0111 has run.
  const sponsors = await readSponsors(list.map((c) => c.id));
  return list.map((c) => {
    const p = prizes.get(c.id);
    return {
      ...c,
      prizes: p && p.length === 3 ? [p[0], p[1], p[2]] : null,
      sponsor: sponsors.get(c.id) ?? null,
    };
  });
}

async function readSponsors(ids: string[]): Promise<Map<string, ChallengeSponsor>> {
  const { data, error } = await requireClient()
    .from('challenges')
    .select('id, sponsor_name, sponsor_message, sponsor_url')
    .in('id', ids)
    .not('sponsor_name', 'is', null);
  const sponsors = new Map<string, ChallengeSponsor>();
  if (error) return sponsors;
  for (const r of (data ?? []) as { id: string; sponsor_name: string; sponsor_message: string | null; sponsor_url: string | null }[]) {
    sponsors.set(r.id, { name: r.sponsor_name, message: r.sponsor_message, url: r.sponsor_url });
  }
  return sponsors;
}

// One challenge's sponsor, for its page; null for none.
export async function getChallengeSponsor(challengeId: string): Promise<ChallengeSponsor | null> {
  if (!supabase) return null;
  return (await readSponsors([challengeId])).get(challengeId) ?? null;
}

// Counts a tap on a sponsor's link (0111). Never throws: a missed count
// mustn't stop the link opening.
export async function recordSponsorClick(challengeId: string): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.rpc('record_sponsor_click', { p_challenge_id: challengeId });
  } catch {
    // Offline, or before 0111 has run.
  }
}

export interface SponsorClicks {
  clicks: number;
  people: number;
  // Between the challenge's start and end.
  clicksDuring: number;
  peopleDuring: number;
}

// Admin only: taps on each challenge's sponsor link. Empty when it can't
// tell (before 0111 has run).
export async function getSponsorClickCounts(challengeIds: string[]): Promise<Map<string, SponsorClicks>> {
  const counts = new Map<string, SponsorClicks>();
  if (!supabase || challengeIds.length === 0) return counts;
  const { data, error } = await supabase.rpc('sponsor_click_counts', { p_challenge_ids: challengeIds });
  if (error) return counts;
  for (const r of (data ?? []) as { challenge_id: string; clicks: number; people: number; clicks_during: number; people_during: number }[]) {
    counts.set(r.challenge_id, {
      clicks: Number(r.clicks),
      people: Number(r.people),
      clicksDuring: Number(r.clicks_during),
      peopleDuring: Number(r.people_during),
    });
  }
  return counts;
}

// Admin only. A blank name takes the sponsor off.
export async function setChallengeSponsor(challengeId: string, sponsor: ChallengeSponsor | null): Promise<void> {
  const { error } = await requireClient().rpc('set_challenge_sponsor', {
    p_challenge_id: challengeId,
    p_name: sponsor?.name ?? null,
    p_message: sponsor?.message ?? null,
    p_url: sponsor?.url ?? null,
  });
  if (error) throw new Error(error.message);
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
  courseId?: string;
  distanceSource?: DistanceSource;
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
    p_course_id: input.courseId ?? null,
    p_distance_source: input.distanceSource ?? null,
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
