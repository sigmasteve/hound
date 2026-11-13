import { supabase } from '../lib/supabase';
import type { GolfClubId, GolfCourseId, GolfFormat } from './golf';

// The client-facing half of Golf — see 0200_golf.sql. The server keeps
// the banks and plays every shot; the app only sends what you chose.

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

async function rpc<T = any>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireClient().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export interface GolfSpot {
  d: number;
  lat: number;
}

export interface GolfHazard {
  type: 'water' | 'bunker' | 'trees' | 'waste';
  d: number;
  lat: number;
  rd: number;
  rl: number;
  drop?: GolfSpot | null;
}

export interface GolfHole {
  no: number;
  par: number;
  length: number;
  name: string;
  center: [number, number][];
  fairwayW: number;
  fairwayFrom: number;
  fairwayTo: number;
  // break: how far a putt drifts across, as a share of its roll (+ is right).
  green: { d: number; lat: number; r: number; break: number };
  pin: GolfSpot;
  hazards: GolfHazard[];
  ob: number;
  wind: { mph: number; deg: number };
  slope: 'downhill' | 'uphill' | null;
}

export interface GolfPlayer {
  userId: string;
  name: string;
  initials: string;
  iconId: string | null;
  frameId: string | null;
  backgroundId: string | null;
  hole: number;
  strokesOnHole: number;
  ball: GolfSpot;
  lie: string;
  scores: (number | null)[];
  total: number;
  toPar: number;
  thru: number;
  skins: number;
  match: string | null;
  done: boolean;
}

export interface GolfPowerSource {
  name: string;
  minutes: number;
  mult: number;
  power: number;
}

export interface GolfGame {
  course: { id: GolfCourseId; name: string; holes: GolfHole[] };
  holes: number;
  format: GolfFormat;
  handsOn: boolean;
  holesPerDay: number;
  status: 'upcoming' | 'live' | 'final';
  me: string | null;
  banks: { yards: number; steps: number; power: number; powerFrom: GolfPowerSource[] };
  today: { holesStarted: number; canStart: boolean };
  wind: { mph: number; deg: number };
  players: GolfPlayer[];
  skins: { hole: number; winner: string | null; bones: number; carried: number }[];
  winner: string | null;
  // The Hound Open (0202): a Global game. Its players are on the board
  // (getOpenBoard), so `players` holds only you.
  isGlobal: boolean;
  // Bones for finishing every hole of the Open, or null for Admin's default.
  finishBones: number | null;
}

export interface GolfShotResult {
  from: GolfSpot;
  // Where it came down, and where the next shot is played from (a drop
  // after water, the same spot after out of bounds).
  to: GolfSpot;
  ball: GolfSpot;
  carry: number;
  lie: string;
  penalty: number;
  holed: boolean;
  // Picked up at par + 4: the hole is over.
  pickedUp: boolean;
  // The whole round's done.
  finished: boolean;
  holeScore: number | null;
  strokesOnHole: number;
  nextHole: number | null;
  banks: { yards: number; power: number };
  wind: { mph: number; deg: number };
  message: string;
  // Birdied the sponsor's hole in the Open: their Bones (0202).
  sponsorBonus: number | null;
}

export interface GolfShotRow {
  seq: number;
  club: GolfClubId;
  from: GolfSpot;
  to: GolfSpot;
  lie: string;
  penalty: number;
  holed: boolean;
}

const num = (v: unknown) => Number(v ?? 0);
const spot = (s: any): GolfSpot => ({ d: num(s?.d), lat: num(s?.lat) });

export function toGolfHole(h: any): GolfHole {
  return {
    no: num(h.no),
    par: num(h.par) || 4,
    length: num(h.length),
    name: h.name ?? `Hole ${num(h.no)}`,
    center: ((h.center ?? [[0, 0]]) as any[]).map((p) => [num(p[0]), num(p[1])] as [number, number]),
    fairwayW: num(h.fairway_w) || 17,
    fairwayFrom: num(h.fairway_from) || 30,
    fairwayTo: num(h.fairway_to) || num(h.green?.d) - 20,
    green: { d: num(h.green?.d), lat: num(h.green?.lat), r: num(h.green?.r) || 14, break: num(h.green?.break) },
    pin: spot(h.pin),
    hazards: ((h.hazards ?? []) as any[]).map((z) => ({
      type: z.type,
      d: num(z.d),
      lat: num(z.lat),
      rd: num(z.rd) || 6,
      rl: num(z.rl) || 6,
      drop: z.drop ? spot(z.drop) : null,
    })),
    ob: num(h.ob) || 70,
    wind: { mph: num(h.wind?.mph), deg: h.wind?.deg == null ? 90 : num(h.wind.deg) },
    slope: h.slope === 'downhill' || h.slope === 'uphill' ? h.slope : null,
  };
}

export function toGolfGame(d: any): GolfGame {
  return {
    course: {
      id: d.course?.id ?? 'links',
      name: d.course?.name ?? 'The course',
      holes: ((d.course?.holes ?? []) as any[]).map(toGolfHole),
    },
    holes: num(d.holes) || 9,
    format: d.format === 'skins' || d.format === 'match' ? d.format : 'stroke',
    handsOn: d.hands_on !== false,
    holesPerDay: num(d.holes_per_day),
    status: d.status ?? 'upcoming',
    me: d.me ?? null,
    banks: {
      yards: num(d.banks?.yards),
      steps: num(d.banks?.steps),
      power: num(d.banks?.power),
      powerFrom: ((d.banks?.power_from ?? []) as any[]).map((p) => ({ name: p.name ?? 'Workout', minutes: num(p.minutes), mult: num(p.mult) || 1, power: num(p.power) })),
    },
    today: { holesStarted: num(d.today?.holes_started), canStart: d.today?.can_start !== false },
    wind: { mph: num(d.wind?.mph), deg: d.wind?.deg == null ? 90 : num(d.wind.deg) },
    players: ((d.players ?? []) as any[]).map((p) => ({
      userId: p.user_id,
      name: p.name ?? 'Someone',
      initials: p.initials ?? '?',
      iconId: p.icon_id ?? null,
      frameId: p.frame_id ?? null,
      backgroundId: p.background_id ?? null,
      hole: num(p.hole) || 1,
      strokesOnHole: num(p.strokes_on_hole),
      ball: spot(p.ball),
      lie: p.lie ?? 'tee',
      scores: ((p.scores ?? []) as any[]).map((s) => (s == null ? null : num(s))),
      total: num(p.total),
      toPar: num(p.to_par),
      thru: num(p.thru),
      skins: num(p.skins),
      match: p.match ?? null,
      done: !!p.done,
    })),
    skins: ((d.skins ?? []) as any[]).map((s) => ({ hole: num(s.hole), winner: s.winner ?? null, bones: num(s.bones), carried: num(s.carried) })),
    winner: d.winner ?? null,
    isGlobal: !!d.is_global,
    finishBones: d.finish_bones == null ? null : num(d.finish_bones),
  };
}

export async function getGolfGame(challengeId: string): Promise<GolfGame | null> {
  const d = await rpc<any>('golf_view', { p_challenge_id: challengeId });
  return d ? toGolfGame(d) : null;
}

export async function setupGolf(
  challengeId: string,
  input: { course: GolfCourseId; holes: 9 | 18; format: GolfFormat; handsOn: boolean; holesPerDay: number; players: string[] },
): Promise<void> {
  await rpc('golf_setup', {
    p_challenge_id: challengeId,
    p_course: input.course,
    p_holes: input.holes,
    p_format: input.format,
    p_hands_on: input.handsOn,
    p_holes_per_day: input.holesPerDay,
    p_players: input.players,
  });
}

export async function takeGolfShot(
  challengeId: string,
  shot: { club: GolfClubId; yards: number; aim: number; power: number; timing: number },
): Promise<GolfShotResult> {
  const d = await rpc<any>('golf_shot', {
    p_challenge_id: challengeId,
    p_club: shot.club,
    p_yards: Math.max(1, Math.round(shot.yards)),
    p_aim: Math.round(shot.aim * 10) / 10,
    p_power: shot.power,
    p_timing: Math.round(shot.timing * 1000) / 1000,
  });
  return {
    from: spot(d.from),
    to: spot(d.to),
    ball: spot(d.ball ?? d.to),
    carry: num(d.carry),
    lie: d.lie ?? 'fairway',
    penalty: num(d.penalty),
    holed: !!d.holed,
    pickedUp: !!d.picked_up,
    finished: !!d.finished,
    holeScore: d.hole_score == null ? null : num(d.hole_score),
    strokesOnHole: num(d.strokes_on_hole),
    nextHole: d.next_hole == null ? null : num(d.next_hole),
    banks: { yards: num(d.banks?.yards), power: num(d.banks?.power) },
    wind: { mph: num(d.wind?.mph), deg: d.wind?.deg == null ? 90 : num(d.wind.deg) },
    message: d.message ?? '',
    sponsorBonus: d.sponsor_bonus == null ? null : num(d.sponsor_bonus),
  };
}

export async function getGolfShots(challengeId: string, userId: string, hole: number): Promise<GolfShotRow[]> {
  const d = await rpc<any[]>('golf_shots', { p_challenge_id: challengeId, p_user: userId, p_hole: hole });
  return ((d ?? []) as any[]).map((s) => ({
    seq: num(s.seq),
    club: s.club,
    from: spot(s.from),
    to: spot(s.to),
    lie: s.lie ?? 'fairway',
    penalty: num(s.penalty),
    holed: !!s.holed,
  }));
}

// ── Admin ──

export interface GolfConfig {
  enabled: boolean;
  steps_per_yard: number;
  strength_mult: number;
  golf_mult: number;
  other_mult: number;
  max_power: number;
  skin_bones: number;
  win_bones: number;
  play_bones: number;
}

export interface GolfOverview {
  config: GolfConfig;
  gamesLive: number;
  games7d: number;
  gamesAll: number;
  players7d: number;
  shots7d: number;
  holes7d: number;
  birdies7d: number;
  eagles7d: number;
  holeInOnesAll: number;
  avgToPar7d: number | null;
  handsOnShare: number | null;
  byCourse: Record<string, number>;
  powerSpent7d: number;
  yardsSpent7d: number;
  // The Hound Open (0202).
  open: { live: number; players: number; finished: number; gamesAll: number } | null;
}

export async function getGolfOverview(): Promise<GolfOverview> {
  const d = await rpc<any>('admin_golf_overview');
  return {
    config: d.config,
    gamesLive: num(d.games_live),
    games7d: num(d.games_7d),
    gamesAll: num(d.games_all),
    players7d: num(d.players_7d),
    shots7d: num(d.shots_7d),
    holes7d: num(d.holes_7d),
    birdies7d: num(d.birdies_7d),
    eagles7d: num(d.eagles_7d),
    holeInOnesAll: num(d.hole_in_ones_all),
    avgToPar7d: d.avg_to_par_7d == null ? null : Number(d.avg_to_par_7d),
    handsOnShare: d.hands_on_share == null ? null : Number(d.hands_on_share),
    byCourse: d.by_course ?? {},
    powerSpent7d: num(d.power_spent_7d),
    yardsSpent7d: num(d.yards_spent_7d),
    open: d.open
      ? { live: num(d.open.live), players: num(d.open.players), finished: num(d.open.finished), gamesAll: num(d.open.games_all) }
      : null,
  };
}

export async function setGolfConfig(patch: Partial<GolfConfig>): Promise<void> {
  await rpc('admin_set_golf_config', { p: patch });
}

export function golfSummary(o: GolfOverview): string {
  const base = `${o.gamesLive} live · ${o.holes7d} ${o.holes7d === 1 ? 'hole' : 'holes'} played this week`;
  return o.open && o.open.live > 0 ? `${base} · Open: ${o.open.players.toLocaleString()} playing` : base;
}

// ── The Hound Open (0202): Golf as a Global Hound Challenge ──

// Admin only, right after publish_global_challenge: the course, 9 or 18,
// the daily limit and the Bones for finishing. Always stroke play, and
// everyone takes their own shots.
export async function setupGlobalGolf(
  challengeId: string,
  input: { course: GolfCourseId; holes: 9 | 18; holesPerDay: number; finishBones: number | null },
): Promise<void> {
  await rpc('golf_setup_global', {
    p_challenge_id: challengeId,
    p_course: input.course,
    p_holes: input.holes,
    p_holes_per_day: input.holesPerDay,
    p_finish_bones: input.finishBones,
  });
}

export type OpenTab = 'top' | 'friends' | 'club';

export interface OpenRow {
  pos: number | null;
  tied: boolean;
  userId: string;
  name: string;
  initials: string;
  iconId: string | null;
  frameId: string | null;
  backgroundId: string | null;
  toPar: number;
  thru: number;
  hole: number;
  strokesOnHole: number;
  total: number;
  finished: boolean;
  isMe: boolean;
  isFriend: boolean;
  best: { hole: number; diff: number } | null;
}

export interface OpenBoard {
  field: number;
  swung: number;
  status: 'upcoming' | 'live' | 'final';
  course: { id: GolfCourseId; name: string };
  holes: number;
  endsAt: string | null;
  joinClosesAt: string | null;
  joined: boolean;
  me: {
    pos: number | null;
    tied: boolean;
    toPar: number;
    thru: number;
    hole: number;
    total: number;
    moved: number;
    behindTop10: number | null;
    finished: boolean;
  } | null;
  rows: OpenRow[];
  more: number | null;
  // The to-par range of that gap ("34 more at −2 and −1").
  moreRange: { best: number; worst: number } | null;
  club: { id: string; name: string; playing: number } | null;
  prizes: number[];
  finishBones: number;
  podium: { place: number; tied: boolean; userId: string; name: string; initials: string; iconId: string | null; toPar: number; total: number; bones: number }[];
  highlights: { userId: string; name: string; hole: number; kind: 'ace' | 'eagle' | 'putt'; feet: number | null }[];
}

export async function getOpenBoard(challengeId: string, tab: OpenTab = 'top'): Promise<OpenBoard> {
  const d = await rpc<any>('golf_open_board', { p_challenge_id: challengeId, p_tab: tab });
  const m = d?.me;
  return {
    field: num(d?.field),
    swung: num(d?.swung),
    status: d?.status ?? 'upcoming',
    course: { id: d?.course?.id ?? 'links', name: d?.course?.name ?? 'The course' },
    holes: num(d?.holes) || 18,
    endsAt: d?.ends_at ?? null,
    joinClosesAt: d?.join_closes_at ?? null,
    joined: !!d?.joined,
    me: m
      ? {
          pos: m.pos == null ? null : num(m.pos),
          tied: !!m.tied,
          toPar: num(m.to_par),
          thru: num(m.thru),
          hole: num(m.hole) || 1,
          total: num(m.total),
          moved: num(m.moved),
          behindTop10: m.behind_top10 == null ? null : num(m.behind_top10),
          finished: !!m.finished,
        }
      : null,
    rows: ((d?.rows ?? []) as any[]).map((r) => ({
      pos: r.pos == null ? null : num(r.pos),
      tied: !!r.tied,
      userId: r.user_id,
      name: r.name ?? 'Someone',
      initials: r.initials ?? '?',
      iconId: r.icon_id ?? null,
      frameId: r.frame_id ?? null,
      backgroundId: r.background_id ?? null,
      toPar: num(r.to_par),
      thru: num(r.thru),
      hole: num(r.hole) || 1,
      strokesOnHole: num(r.strokes_on_hole),
      total: num(r.total),
      finished: !!r.finished,
      isMe: !!r.is_me,
      isFriend: !!r.is_friend,
      best: r.best ? { hole: num(r.best.hole), diff: num(r.best.diff) } : null,
    })),
    more: d?.more == null ? null : num(d.more),
    moreRange: d?.more_range ? { best: num(d.more_range.best), worst: num(d.more_range.worst) } : null,
    club: d?.club ? { id: d.club.id, name: d.club.name ?? 'Your club', playing: num(d.club.playing) } : null,
    prizes: ((d?.prizes ?? []) as any[]).map(num),
    finishBones: num(d?.finish_bones),
    podium: ((d?.podium ?? []) as any[]).map((p) => ({
      place: num(p.place),
      tied: !!p.tied,
      userId: p.user_id,
      name: p.name ?? 'Someone',
      initials: p.initials ?? '?',
      iconId: p.icon_id ?? null,
      toPar: num(p.to_par),
      total: num(p.total),
      bones: num(p.bones),
    })),
    highlights: ((d?.highlights ?? []) as any[]).map((h) => ({
      userId: h.user_id,
      name: h.name ?? 'Someone',
      hole: num(h.hole),
      kind: h.kind === 'ace' || h.kind === 'eagle' ? h.kind : 'putt',
      feet: h.feet == null ? null : num(h.feet),
    })),
  };
}

// "T41", "1", or "–" for someone who hasn't swung yet.
export function openPos(pos: number | null, tied: boolean): string {
  if (pos == null) return '–';
  return `${tied ? 'T' : ''}${pos}`;
}
