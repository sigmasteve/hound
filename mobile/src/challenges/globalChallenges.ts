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
export const GLOBAL_KINDS: ChallengeKind[] = ['steps', 'streak', 'distance', 'bingo', 'seventyfive', 'journey', 'checklist', 'houndopoly', 'doors', 'packs', 'golf'];

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
  // A Journey's course (src/journeys/courses.ts); on a miles pool, the
  // course map the group's miles are shown along.
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
    id: 'houndopoly-three-weeks',
    name: 'Hound’opoly',
    kind: 'houndopoly',
    durationDays: 21,
    blurb: 'The property board game, played with your steps. Three weeks; richest at the end wins.',
    joinWindow: '3',
  },
  {
    id: 'daily-doors',
    name: 'Daily Doors',
    kind: 'doors',
    durationDays: 14,
    blurb: 'A door a day for two weeks. Open it to see the day’s task, do it by midnight. Most points wins.',
    joinWindow: '3',
  },
  {
    id: 'pack-wars',
    name: 'Pack Wars',
    kind: 'packs',
    durationDays: 14,
    blurb: 'Four packs fight over one neighborhood map. Vote your pack’s march each day; most ground at the end wins. 7 to 30 days.',
    joinWindow: '3',
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
    courseId: 'appalachian',
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
    id: 'knock-knock-hound',
    name: 'Knock Knock, Hound',
    kind: 'doors',
    durationDays: 24,
    blurb: 'A door a day from Dec 1 to Dec 24, with Bones behind every third and a prize behind the last. Start it Dec 1.',
    joinWindow: '7',
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
  // 0203_sponsor_v2.sql: where else they show. All optional, so a
  // sponsor read before 0203 (or set the old way) is just the line.
  logoUrl?: string | null;
  // #rrggbb, for the boards, the logo square and the cards' trim.
  color?: string | null;
  // "presented by" on the title, Today and the leaderboard.
  presented?: boolean;
  // Boards behind every green (Golf).
  boards?: boolean;
  // The sponsor's hole (1–9, both nines on 18) and its birdie Bones.
  hole?: number | null;
  holeBones?: number | null;
  // Once, when you finish the round (Golf), with a link labelled so.
  finishMessage?: string | null;
  finishLabel?: string | null;
  // "Prizes from …" on the prizes, with a line of the admin's own.
  prizes?: boolean;
  prizeNote?: string | null;
}

// Where a sponsor was seen or tapped, for its report (0203).
export type SponsorPlacement = 'presented' | 'today' | 'board' | 'course' | 'hole' | 'finish' | 'prizes';

export const SPONSOR_PLACEMENT_NAME: Record<SponsorPlacement, string> = {
  presented: 'Presented by',
  today: 'Today',
  board: 'Leaderboard',
  course: 'Course boards',
  hole: 'Hole sponsor',
  finish: 'Finish message',
  prizes: 'Prizes from',
};

// The sponsor's colour, or Hound's amber.
export function sponsorColor(s: ChallengeSponsor | null | undefined): string {
  return s?.color && /^#[0-9a-fA-F]{6}$/.test(s.color) ? s.color : '#f08a24';
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

const SPONSOR_V2_COLUMNS =
  'sponsor_logo_url, sponsor_color, sponsor_presented, sponsor_boards, sponsor_hole, sponsor_hole_bones, sponsor_finish_message, sponsor_finish_label, sponsor_prizes, sponsor_prize_note';

async function readSponsors(ids: string[]): Promise<Map<string, ChallengeSponsor>> {
  const sponsors = new Map<string, ChallengeSponsor>();
  if (ids.length === 0) return sponsors;
  const client = requireClient();
  // The placements (0203) when they're there; else just the line (0111).
  const first = await client
    .from('challenges')
    .select(`id, sponsor_name, sponsor_message, sponsor_url, ${SPONSOR_V2_COLUMNS}`)
    .in('id', ids)
    .not('sponsor_name', 'is', null);
  let data: any[] | null = first.data as any[] | null;
  let error = first.error;
  if (error) {
    ({ data, error } = await client
      .from('challenges')
      .select('id, sponsor_name, sponsor_message, sponsor_url')
      .in('id', ids)
      .not('sponsor_name', 'is', null));
  }
  if (error) return sponsors;
  for (const r of (data ?? []) as any[]) {
    sponsors.set(r.id, rowToSponsor(r));
  }
  return sponsors;
}

function rowToSponsor(r: any): ChallengeSponsor {
  return {
    name: r.sponsor_name,
    message: r.sponsor_message ?? null,
    url: r.sponsor_url ?? null,
    logoUrl: r.sponsor_logo_url ?? null,
    color: r.sponsor_color ?? null,
    presented: !!r.sponsor_presented,
    boards: !!r.sponsor_boards,
    hole: r.sponsor_hole == null ? null : Number(r.sponsor_hole),
    holeBones: r.sponsor_hole_bones == null ? null : Number(r.sponsor_hole_bones),
    finishMessage: r.sponsor_finish_message ?? null,
    finishLabel: r.sponsor_finish_label ?? null,
    prizes: !!r.sponsor_prizes,
    prizeNote: r.sponsor_prize_note ?? null,
  };
}

// One challenge's sponsor, for its page; null for none.
export async function getChallengeSponsor(challengeId: string): Promise<ChallengeSponsor | null> {
  if (!supabase) return null;
  return (await readSponsors([challengeId])).get(challengeId) ?? null;
}

// Counts a tap on a sponsor's link (0111). Never throws: a missed count
// mustn't stop the link opening.
export async function recordSponsorClick(challengeId: string, placement?: SponsorPlacement): Promise<void> {
  if (!supabase) return;
  try {
    const { error } = await supabase.rpc(
      'record_sponsor_click',
      placement ? { p_challenge_id: challengeId, p_placement: placement } : { p_challenge_id: challengeId },
    );
    // Before 0203: count it the old way.
    if (error && placement) await supabase.rpc('record_sponsor_click', { p_challenge_id: challengeId });
  } catch {
    // Offline, or before 0111 has run.
  }
}

// Counts that a sponsor was seen, once per screen open (0203). Never
// throws, and a phone sends each challenge's placements once a minute at
// most, so a re-render doesn't count again.
const viewsSent = new Map<string, number>();
export function recordSponsorViews(challengeId: string, placements: SponsorPlacement[]): void {
  if (!supabase || placements.length === 0) return;
  const now = Date.now();
  const fresh = placements.filter((p) => {
    const key = `${challengeId}:${p}`;
    const last = viewsSent.get(key);
    if (last && now - last < 60_000) return false;
    viewsSent.set(key, now);
    return true;
  });
  if (fresh.length === 0) return;
  Promise.resolve(supabase.rpc('record_sponsor_views', { p_challenge_id: challengeId, p_placements: fresh })).catch(() => {});
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

// Admin only (0203): the sponsor and where they show. A blank name takes
// everything off.
export async function setChallengeSponsorV2(challengeId: string, sponsor: ChallengeSponsor | null): Promise<void> {
  const name = sponsor?.name.trim() ?? '';
  const p = !sponsor || !name
    ? { name: null }
    : {
        name,
        message: sponsor.message?.trim() || null,
        url: sponsor.url?.trim() || null,
        logo_url: sponsor.logoUrl?.trim() || null,
        color: sponsor.color?.trim() || null,
        presented: !!sponsor.presented,
        boards: !!sponsor.boards,
        hole: sponsor.hole ?? null,
        hole_bones: sponsor.hole ? sponsor.holeBones ?? 5 : null,
        finish_message: sponsor.finishMessage?.trim() || null,
        finish_label: sponsor.finishLabel?.trim() || null,
        prizes: !!sponsor.prizes,
        prize_note: sponsor.prizeNote?.trim() || null,
      };
  const { error } = await requireClient().rpc('set_challenge_sponsor_v2', { p_challenge_id: challengeId, p });
  if (error) throw new Error(error.message);
}

export const SPONSOR_LOGO_BUCKET = 'sponsor-logos';

// Admin only: a square logo (picked and resized like a dog photo) into the
// public bucket (0203); returns its public URL.
export async function uploadSponsorLogo(base64Jpeg: string): Promise<string> {
  const client = requireClient();
  const path = `logo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await client.storage
    .from(SPONSOR_LOGO_BUCKET)
    .upload(path, base64ToBytes(base64Jpeg), { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error(error.message);
  return client.storage.from(SPONSOR_LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
}

function base64ToBytes(b64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (chars.indexOf(clean[i]) << 18) |
      (chars.indexOf(clean[i + 1]) << 12) |
      ((i + 2 < clean.length ? chars.indexOf(clean[i + 2]) : 0) << 6) |
      (i + 3 < clean.length ? chars.indexOf(clean[i + 3]) : 0);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length && o < out.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length && o < out.length) out[o++] = n & 255;
  }
  return out;
}

export interface SponsorReport {
  challengeId: string;
  name: string;
  sponsor: { name: string; logoUrl: string | null; color: string | null };
  startsAt: string;
  endsAt: string;
  players: number;
  reached: number;
  views: number;
  taps: number;
  tapRate: number;
  placements: { placement: SponsorPlacement; views: number; viewers: number; taps: number }[];
  hole: { hole: number; played: number; birdies: number; bones: number } | null;
}

// Admin only (0203): one sponsored challenge's numbers, counts only.
export async function getSponsorReport(challengeId: string): Promise<SponsorReport> {
  const { data, error } = await requireClient().rpc('admin_sponsor_report', { p_challenge_id: challengeId });
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as any;
  return {
    challengeId: d.challenge_id ?? challengeId,
    name: d.name ?? '',
    sponsor: { name: d.sponsor?.name ?? '', logoUrl: d.sponsor?.logo_url ?? null, color: d.sponsor?.color ?? null },
    startsAt: d.starts_at,
    endsAt: d.ends_at,
    players: Number(d.players ?? 0),
    reached: Number(d.reached ?? 0),
    views: Number(d.views ?? 0),
    taps: Number(d.taps ?? 0),
    tapRate: Number(d.tap_rate ?? 0),
    placements: ((d.placements ?? []) as any[]).map((p) => ({
      placement: p.placement,
      views: Number(p.views ?? 0),
      viewers: Number(p.viewers ?? 0),
      taps: Number(p.taps ?? 0),
    })),
    hole: d.hole
      ? { hole: Number(d.hole.hole), played: Number(d.hole.played ?? 0), birdies: Number(d.hole.birdies ?? 0), bones: Number(d.hole.bones ?? 0) }
      : null,
  };
}

export interface SponsorOverview {
  sponsoredLive: number;
  sponsoredAll: number;
  views7d: number;
  taps7d: number;
  reached7d: number;
  challenges: { challengeId: string; name: string; sponsorName: string; startsAt: string; endsAt: string; views: number; taps: number }[];
}

// Admin only (0203): the Sponsors fold.
export async function getSponsorOverview(): Promise<SponsorOverview> {
  const { data, error } = await requireClient().rpc('admin_sponsor_overview');
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as any;
  return {
    sponsoredLive: Number(d.sponsored_live ?? 0),
    sponsoredAll: Number(d.sponsored_all ?? 0),
    views7d: Number(d.views_7d ?? 0),
    taps7d: Number(d.taps_7d ?? 0),
    reached7d: Number(d.reached_7d ?? 0),
    challenges: ((d.challenges ?? []) as any[]).map((c) => ({
      challengeId: c.challenge_id,
      name: c.name ?? '',
      sponsorName: c.sponsor_name ?? '',
      startsAt: c.starts_at,
      endsAt: c.ends_at,
      views: Number(c.views ?? 0),
      taps: Number(c.taps ?? 0),
    })),
  };
}

// The Sponsors fold's one line.
export function sponsorSummary(o: SponsorOverview): string {
  if (o.sponsoredAll === 0) return 'No sponsors yet';
  return `${o.sponsoredLive} sponsored now · ${o.views7d.toLocaleString()} views · ${o.taps7d.toLocaleString()} taps this week`;
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
  // A hound card's size (0179).
  bingoSize?: 3 | 4 | 5;
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
    // 0179; only sent when picked.
    ...(input.bingoSize ? { p_bingo_size: input.bingoSize } : {}),
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
