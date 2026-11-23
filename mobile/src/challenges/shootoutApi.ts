import { supabase } from '../lib/supabase';

// The Hound Shootout (0220_shootout_kind.sql, 0221_shootout.sql): a Global
// Hound Challenge of penalty kicks. Your steps today buy the kicks (one per
// 1,000, up to 20 a day, no carry-over). Each kick: aim at one of six
// spots, then stop the power meter in the green. Too soft and the keeper
// holds it; too hard and it's over the bar or wide. The green is narrowest
// for the top corners and narrows again as the week goes on. The keeper
// reads your last 10 kicks and dives where you go most. A goal is 1, top
// bins (a top corner) 2, and the golden ball (one kick a day) doubles it.
// A strength workout adds pace: the keeper saves fewer. Most goals wins;
// ties go to the best conversion. The server decides every kick.

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
const numOrNull = (v: unknown) => (v == null ? null : Number(v));

// The six spots, from the kicker's side: 0-2 top left, middle, right; 3-5
// low left, middle, right.
export type ShootoutZone = 0 | 1 | 2 | 3 | 4 | 5;
export const ZONE_NAMES = ['Top left', 'Top middle', 'Top right', 'Low left', 'Low middle', 'Low right'] as const;
export const isTopBins = (z: number) => z === 0 || z === 2;
// Keeper: 0 dives left, 1 stays home, 2 dives right.
export type ShootoutDive = 0 | 1 | 2;
export type ShootoutResult = 'goal' | 'saved' | 'held' | 'over' | 'wide';

export const SHOOTOUT_CENTER = 62;
// Half the green's width at each spot on day one (×0.85 mid-week, ×0.70 at
// the end), as 0221's shootout_width.
export const BASE_WIDTHS = [7, 9, 7, 10, 13, 10];

export interface ShootoutKickRow {
  n: number;
  day: string;
  zone: ShootoutZone;
  power: number;
  golden: boolean;
  dive: ShootoutDive;
  perfect: boolean;
  result: ShootoutResult;
  points: number;
}

export interface ShootoutSponsor {
  name: string;
  logoUrl: string | null;
  color: string | null;
}

export interface ShootoutLive {
  joined: boolean;
  dayNo: number;
  days: number;
  stage: 1 | 2 | 3;
  factor: number;
  center: number;
  // Half the green's width at each of the six spots today.
  widths: number[];
  perfectShare: number;
  steps: number;
  kicksEarned: number;
  kicksTaken: number;
  kicksLeft: number;
  nextKickAt: number | null;
  cap: number;
  goldenNext: boolean;
  goldenDone: boolean;
  // Strength workouts today, and how much they take off his saves (%).
  pace: { strength: number; cut: number };
  // How the keeper leans (left, home, right; sums to 1) and how many of
  // your kicks he's read (up to 10).
  keeper: { lean: [number, number, number]; reads: number };
  me: {
    points: number;
    goals: number;
    kicks: number;
    topBins: number;
    saved: number;
    missed: number;
    curStreak: number;
    bestStreak: number;
    rank: number | null;
  };
  // Your kicks and goals at each spot, all Shootout.
  zones: { kicks: number; goals: number }[];
  field: number;
  recent: ShootoutKickRow[];
  sponsor: ShootoutSponsor | null;
  canKick: boolean;
  reason: string | null;
}

function toKickRow(r: any): ShootoutKickRow {
  return {
    n: num(r?.n),
    day: r?.day ?? '',
    zone: (num(r?.zone) % 6) as ShootoutZone,
    power: num(r?.power),
    golden: !!r?.golden,
    dive: (num(r?.dive) % 3) as ShootoutDive,
    perfect: !!r?.perfect,
    result: (r?.result ?? 'saved') as ShootoutResult,
    points: num(r?.points),
  };
}

const toSponsor = (sp: any): ShootoutSponsor | null =>
  sp ? { name: sp.name ?? 'Our sponsor', logoUrl: sp.logo_url ?? null, color: sp.color ?? null } : null;

function toLean(v: any): [number, number, number] {
  const a = Array.isArray(v) ? v.map(Number) : [];
  return a.length === 3 ? [a[0], a[1], a[2]] : [0.4, 0.2, 0.4];
}

export function toShootoutLive(d: any): ShootoutLive {
  const factor = num(d?.factor) || 1;
  const widths = Array.isArray(d?.widths) && d.widths.length === 6 ? (d.widths as any[]).map(Number) : BASE_WIDTHS.map((w) => w * factor);
  return {
    joined: d?.joined !== false,
    dayNo: num(d?.day_no),
    days: num(d?.days) || 7,
    stage: ((num(d?.stage) || 1) as 1 | 2 | 3),
    factor,
    center: num(d?.center) || SHOOTOUT_CENTER,
    widths,
    perfectShare: num(d?.perfect_share) || 0.35,
    steps: num(d?.steps),
    kicksEarned: num(d?.kicks_earned),
    kicksTaken: num(d?.kicks_taken),
    kicksLeft: num(d?.kicks_left),
    nextKickAt: numOrNull(d?.next_kick_at),
    cap: num(d?.cap) || 20,
    goldenNext: !!d?.golden_next,
    goldenDone: !!d?.golden_done,
    pace: { strength: num(d?.pace?.strength), cut: num(d?.pace?.cut) },
    keeper: { lean: toLean(d?.keeper?.lean), reads: num(d?.keeper?.reads) },
    me: {
      points: num(d?.me?.points),
      goals: num(d?.me?.goals),
      kicks: num(d?.me?.kicks),
      topBins: num(d?.me?.top_bins),
      saved: num(d?.me?.saved),
      missed: num(d?.me?.missed),
      curStreak: num(d?.me?.cur_streak),
      bestStreak: num(d?.me?.best_streak),
      rank: numOrNull(d?.me?.rank),
    },
    zones: Array.isArray(d?.zones) ? (d.zones as any[]).map((z) => ({ kicks: num(z?.kicks), goals: num(z?.goals) })) : Array.from({ length: 6 }, () => ({ kicks: 0, goals: 0 })),
    field: num(d?.field),
    recent: ((d?.recent ?? []) as any[]).map(toKickRow),
    sponsor: toSponsor(d?.sponsor),
    canKick: !!d?.can_kick,
    reason: d?.reason ?? null,
  };
}

export async function getShootoutLive(challengeId: string): Promise<ShootoutLive> {
  return toShootoutLive(await rpc<any>('shootout_live', { p_challenge_id: challengeId }));
}

export interface ShootoutKick {
  n: number;
  zone: ShootoutZone;
  power: number;
  golden: boolean;
  dive: ShootoutDive;
  perfect: boolean;
  result: ShootoutResult;
  points: number;
  pace: number;
  total: number;
  goals: number;
  kicks: number;
  streak: number;
  bestStreak: number;
  rank: number | null;
  kicksLeft: number;
  goldenNext: boolean;
  lean: [number, number, number];
  message: string;
}

export function toShootoutKick(d: any): ShootoutKick {
  return {
    ...toKickRow(d),
    pace: num(d?.pace),
    total: num(d?.total),
    goals: num(d?.goals),
    kicks: num(d?.kicks),
    streak: num(d?.streak),
    bestStreak: num(d?.best_streak),
    rank: numOrNull(d?.rank),
    kicksLeft: num(d?.kicks_left),
    goldenNext: !!d?.golden_next,
    lean: toLean(d?.lean),
    message: d?.message ?? '',
  };
}

// A kick: where you aimed and where you stopped the meter (0-100).
// Auto (0257): the server takes every kick left, at the low spots.
export async function autoShootout(challengeId: string): Promise<{ kicks: number; goals: number; points: number; saved: number; offTarget: number }> {
  const d = await rpc<any>('shootout_kick_auto', { p_challenge_id: challengeId });
  const n = (v: unknown) => Number(v ?? 0);
  return { kicks: n(d?.kicks), goals: n(d?.goals), points: n(d?.points), saved: n(d?.saved), offTarget: n(d?.offTarget) };
}

export async function kickShootout(challengeId: string, zone: number, power: number): Promise<ShootoutKick> {
  return toShootoutKick(await rpc<any>('shootout_kick', { p_challenge_id: challengeId, p_zone: zone, p_power: Math.round(power) }));
}

// ── The board ──

export type ShootoutTab = 'top' | 'friends' | 'club';

export interface ShootoutRow {
  pos: number | null;
  tied: boolean;
  userId: string;
  name: string;
  initials: string;
  iconId: string | null;
  frameId: string | null;
  backgroundId: string | null;
  points: number;
  goals: number;
  kicks: number;
  topBins: number;
  bestStreak: number;
  // Where they score most (null before their first goal).
  favZone: ShootoutZone | null;
  isMe: boolean;
  isFriend: boolean;
  isClub: boolean;
}

export interface ShootoutPodium {
  place: number;
  tied: boolean;
  userId: string;
  name: string;
  initials: string;
  iconId: string | null;
  points: number;
  goals: number;
  kicks: number;
  bones: number;
}

export interface ShootoutPrizes {
  first: number;
  second: number;
  third: number;
  top10: number;
  streak: number;
  fifteen: number;
}

export interface ShootoutBoard {
  field: number;
  kicked: number;
  status: 'upcoming' | 'live' | 'final';
  dayNo: number;
  days: number;
  endsAt: string | null;
  joinClosesAt: string | null;
  joined: boolean;
  me: { pos: number | null; tied: boolean; points: number; goals: number; kicks: number; topBins: number; bestStreak: number; curStreak: number; moved: number } | null;
  rows: ShootoutRow[];
  more: number | null;
  club: { id: string; name: string; playing: number } | null;
  prizes: ShootoutPrizes;
  sponsor: ShootoutSponsor | null;
  bestStreak: { name: string; streak: number } | null;
  goalsTotal: number;
  topBinsTotal: number;
  podium: ShootoutPodium[];
  streakWinner: { name: string; streak: number; bones: number } | null;
  myBones: { place: number; streak: number; fifteen: number; total: number } | null;
}

export function conversion(goals: number, kicks: number): string {
  return kicks > 0 ? `${Math.round((goals / kicks) * 100)}%` : '–';
}

export function toShootoutPrizes(pz: any): ShootoutPrizes {
  const places = Array.isArray(pz?.places) ? (pz.places as any[]).map(num) : [500, 300, 200];
  return {
    first: places[0] ?? 500,
    second: places[1] ?? 300,
    third: places[2] ?? 200,
    top10: num(pz?.top10 ?? 100),
    streak: num(pz?.streak ?? 150),
    fifteen: num(pz?.fifteen ?? 25),
  };
}

export function toShootoutBoard(d: any): ShootoutBoard {
  const m = d?.me;
  const mb = d?.my_bones;
  const sws = (Array.isArray(d?.streak_winner) ? d.streak_winner : d?.streak_winner ? [d.streak_winner] : []) as any[];
  return {
    field: num(d?.field),
    kicked: num(d?.kicked),
    status: d?.status === 'final' || d?.status === 'live' ? d.status : 'upcoming',
    dayNo: num(d?.day_no),
    days: num(d?.days) || 7,
    endsAt: d?.ends_at ?? null,
    joinClosesAt: d?.join_closes_at ?? null,
    joined: !!d?.joined,
    me: m
      ? {
          pos: numOrNull(m.pos),
          tied: !!m.tied,
          points: num(m.points),
          goals: num(m.goals),
          kicks: num(m.kicks),
          topBins: num(m.top_bins),
          bestStreak: num(m.best_streak),
          curStreak: num(m.cur_streak),
          moved: num(m.moved),
        }
      : null,
    rows: ((d?.rows ?? []) as any[]).map((r) => ({
      pos: numOrNull(r.pos),
      tied: !!r.tied,
      userId: r.user_id,
      name: r.name ?? 'Someone',
      initials: r.initials ?? '?',
      iconId: r.icon_id ?? null,
      frameId: r.frame_id ?? null,
      backgroundId: r.background_id ?? null,
      points: num(r.points),
      goals: num(r.goals),
      kicks: num(r.kicks),
      topBins: num(r.top_bins),
      bestStreak: num(r.best_streak),
      favZone: r.fav_zone == null ? null : ((num(r.fav_zone) % 6) as ShootoutZone),
      isMe: !!r.is_me,
      isFriend: !!r.is_friend,
      isClub: !!r.in_club,
    })),
    more: numOrNull(d?.more),
    club: d?.club ? { id: d.club.id, name: d.club.name ?? 'Your club', playing: num(d.club.playing) } : null,
    prizes: toShootoutPrizes(d?.prizes),
    sponsor: toSponsor(d?.sponsor),
    bestStreak: d?.best_streak ? { name: d.best_streak.name ?? 'Someone', streak: num(d.best_streak.streak) } : null,
    goalsTotal: num(d?.goals_total),
    topBinsTotal: num(d?.top_bins_total),
    podium: ((d?.podium ?? []) as any[]).map((p) => ({
      place: num(p.place),
      tied: !!p.tied,
      userId: p.user_id,
      name: p.name ?? 'Someone',
      initials: p.initials ?? '?',
      iconId: p.icon_id ?? null,
      points: num(p.points),
      goals: num(p.goals),
      kicks: num(p.kicks),
      bones: num(p.bones),
    })),
    streakWinner: sws.length
      ? { name: sws.map((x) => x.name ?? 'Someone').join(' & '), streak: num(sws[0].streak), bones: num(sws[0].bones) }
      : null,
    myBones: mb
      ? { place: num(mb.place_bones), streak: num(mb.streak_bones), fifteen: num(mb.fifteen_bones), total: num(mb.total) }
      : null,
  };
}

export async function getShootoutBoard(challengeId: string, tab: ShootoutTab = 'top'): Promise<ShootoutBoard> {
  return toShootoutBoard(await rpc<any>('shootout_board', { p_challenge_id: challengeId, p_tab: tab }));
}

// "T4", "1", or "–" for someone who hasn't kicked yet.
export function shootoutPos(pos: number | null, tied: boolean): string {
  if (pos == null) return '–';
  return `${tied ? 'T' : ''}${pos}`;
}

// ── Admin ──

export const DEFAULT_SHOOTOUT_PRIZES: ShootoutPrizes = { first: 500, second: 300, third: 200, top10: 100, streak: 150, fifteen: 25 };

// Admin only, right after publish_global_challenge: the prizes.
export async function setupGlobalShootout(challengeId: string, prizes: ShootoutPrizes): Promise<void> {
  await rpc('shootout_setup_global', {
    p_challenge_id: challengeId,
    p_prizes: {
      places: [prizes.first, prizes.second, prizes.third],
      top10: prizes.top10,
      streak: prizes.streak,
      fifteen: prizes.fifteen,
    },
  });
}

export interface ShootoutOverview {
  live: number;
  all: number;
  joined: number;
  kickedEver: number;
  kicked7d: number;
  kicks7d: number;
  scored7d: number;
  goals7d: number;
  topBins7d: number;
  saved7d: number;
  held7d: number;
  off7d: number;
  perfect7d: number;
  goldenScored7d: number;
  paced7d: number;
  zones7d: number[];
  prizeBonesAll: number;
  avgGoals: number | null;
  bestStreakEver: { name: string; streak: number } | null;
}

export async function getShootoutOverview(): Promise<ShootoutOverview> {
  const d = await rpc<any>('admin_shootout_overview');
  return {
    live: num(d?.shootouts_live),
    all: num(d?.shootouts_all),
    joined: num(d?.players),
    kickedEver: num(d?.kicked_ever),
    kicked7d: num(d?.kicked_7d),
    kicks7d: num(d?.kicks_7d),
    scored7d: num(d?.scored_7d),
    goals7d: num(d?.goals_7d),
    topBins7d: num(d?.top_bins_7d),
    saved7d: num(d?.saved_7d),
    held7d: num(d?.held_7d),
    off7d: num(d?.off_7d),
    perfect7d: num(d?.perfect_7d),
    goldenScored7d: num(d?.golden_scored_7d),
    paced7d: num(d?.paced_7d),
    zones7d: Array.isArray(d?.zones_7d) ? (d.zones_7d as any[]).map(num) : [0, 0, 0, 0, 0, 0],
    prizeBonesAll: num(d?.prize_bones_all),
    avgGoals: d?.avg_goals == null ? null : Number(d.avg_goals),
    bestStreakEver: d?.best_streak_ever ? { name: d.best_streak_ever.name ?? 'Someone', streak: num(d.best_streak_ever.streak) } : null,
  };
}

export function shootoutSummary(o: ShootoutOverview): string {
  if (o.all === 0) return 'No Shootout yet';
  return `${o.kickedEver.toLocaleString()} have kicked · ${o.kicked7d.toLocaleString()} this week`;
}
