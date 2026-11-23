import { supabase } from '../lib/supabase';

// The Hound Home Run Derby (0210_derby_kind.sql, 0211_derby.sql): a
// Global Hound Challenge where every pitch is a meatball and only your
// timing counts. Your steps today buy the swings (one per 1,000, up to 20
// a day, no carry-over); the server throws each pitch and decides the
// swing. Distance comes from the timing (up to 435 ft), your steps today
// (+10 ft per 5,000, up to +40) and a strength workout (+15, or +25 for
// two), 500 ft at most. 475+ ft is a Moonshot (counts as 2); a home run
// off a golden ball counts double. Most home runs wins; ties go to the
// longest home run.

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

export type DerbyStage = 1 | 2 | 3;
export type DerbyDir = 'left' | 'center' | 'right';
export type DerbyResult = 'hr' | 'fly_out' | 'whiff' | 'take';

// How close to on time each distance band is, in ms either side; the
// server scales them by the stage's factor (1, 0.85, 0.70).
export interface DerbyBands {
  b10: number;
  b20: number;
  b30: number;
  b45: number;
  b70: number;
  // 70f–120f off: still a fly ball, caught at the wall (0211).
  warning: number;
}

export const DERBY_SPEEDS: Record<DerbyStage, { mph: number; factor: number }> = {
  1: { mph: 70, factor: 1 },
  2: { mph: 75, factor: 0.85 },
  3: { mph: 80, factor: 0.7 },
};

export function bandsFor(factor: number): DerbyBands {
  const f = factor > 0 ? factor : 1;
  return { b10: 10 * f, b20: 20 * f, b30: 30 * f, b45: 45 * f, b70: 70 * f, warning: 120 * f };
}

function toBands(d: any, factor: number): DerbyBands {
  const fallback = bandsFor(factor);
  if (!d || typeof d !== 'object') return fallback;
  if (Array.isArray(d) && d.length >= 5) return { b10: num(d[0]), b20: num(d[1]), b30: num(d[2]), b45: num(d[3]), b70: num(d[4]), warning: d.length > 5 ? num(d[5]) : fallback.warning };
  const pick = (keys: string[], dflt: number) => {
    for (const k of keys) if (d[k] != null) return num(d[k]);
    return dflt;
  };
  return {
    b10: pick(['dead_on', 'b10', '10', 'perfect', 'barrel'], fallback.b10),
    b20: pick(['center', 'b20', '20', 'great'], fallback.b20),
    b30: pick(['b30', '30', 'good'], fallback.b30),
    b45: pick(['gaps', 'b45', '45', 'ok', 'gap'], fallback.b45),
    b70: pick(['b70', '70', 'contact'], fallback.b70),
    warning: pick(['warning_track', 'warning', 'b120', '120'], fallback.warning),
  };
}

export interface DerbySponsor {
  name: string;
  logoUrl: string | null;
  color: string | null;
  signBones: number;
  signHits: number;
  signCap: number;
}

export interface DerbySwingRow {
  n: number;
  day: string | null;
  golden: boolean;
  result: DerbyResult;
  ft: number | null;
  moonshot: boolean;
  sign: boolean;
  counts: number;
}

export interface DerbyPitch {
  n: number;
  golden: boolean;
  mph: number;
  ms: number;
  bands: DerbyBands;
  swingsLeft: number;
  // 0231: where the meatball crosses, in half-widths of the zone.
  px: number;
  py: number;
}

export interface DerbyLive {
  joined: boolean;
  dayNo: number;
  days: number;
  stage: DerbyStage;
  mph: number;
  factor: number;
  steps: number;
  // Today's pitch speed and bands, before the first pitch (0211).
  ms: number;
  bands: DerbyBands;
  swingsEarned: number;
  swingsTaken: number;
  swingsLeft: number;
  nextSwingAt: number | null;
  cap: number;
  // dueNext: a golden ball is still to come today (not "the next pitch").
  goldens: { shown: number; dueNext: boolean; secondUnlocksAt: number; secondUnlocked: boolean };
  power: { stepsFt: number; workoutFt: number };
  pending: DerbyPitch | null;
  me: { hrs: number; longestFt: number; rank: number | null; moonshots: number; goldensHit: number; signHits: number; swings: number };
  field: number;
  recent: DerbySwingRow[];
  sponsor: DerbySponsor | null;
  canSwing: boolean;
  reason: string | null;
}

function toPitch(d: any, factor: number): DerbyPitch {
  return {
    n: num(d?.n),
    golden: !!d?.golden,
    mph: num(d?.mph) || 70,
    ms: num(d?.ms) || 700,
    bands: toBands(d?.bands, factor),
    swingsLeft: num(d?.swings_left),
    px: num(d?.px),
    py: num(d?.py),
  };
}

function toSwingRow(r: any): DerbySwingRow {
  const result: DerbyResult = r?.result === 'hr' || r?.result === 'fly_out' || r?.result === 'take' ? r.result : r?.hr ? 'hr' : 'whiff';
  return {
    n: num(r?.n),
    day: r?.day ?? null,
    golden: !!r?.golden,
    result: r?.hr === true ? 'hr' : result,
    ft: numOrNull(r?.ft),
    moonshot: !!r?.moonshot,
    sign: !!r?.sign,
    counts: num(r?.counts),
  };
}

export function toDerbyLive(d: any): DerbyLive {
  const stage = (num(d?.stage) || 1) as DerbyStage;
  const factor = num(d?.factor) || DERBY_SPEEDS[stage]?.factor || 1;
  const sp = d?.sponsor;
  return {
    joined: d?.joined !== false,
    dayNo: num(d?.day_no),
    days: num(d?.days) || 7,
    stage,
    mph: num(d?.mph) || DERBY_SPEEDS[stage]?.mph || 70,
    factor,
    steps: num(d?.steps),
    ms: num(d?.ms) || 700,
    bands: toBands(d?.bands, factor),
    swingsEarned: num(d?.swings_earned),
    swingsTaken: num(d?.swings_taken),
    swingsLeft: num(d?.swings_left),
    nextSwingAt: numOrNull(d?.next_swing_at),
    cap: num(d?.cap) || 20,
    goldens: {
      shown: num(d?.goldens?.shown),
      dueNext: !!d?.goldens?.due_next,
      secondUnlocksAt: num(d?.goldens?.second_unlocks_at) || 15000,
      secondUnlocked: !!d?.goldens?.second_unlocked,
    },
    power: { stepsFt: num(d?.power?.steps_ft), workoutFt: num(d?.power?.workout_ft) },
    pending: d?.pending ? toPitch(d.pending, factor) : null,
    me: {
      hrs: num(d?.me?.hrs),
      longestFt: num(d?.me?.longest_ft),
      rank: numOrNull(d?.me?.rank),
      moonshots: num(d?.me?.moonshots),
      goldensHit: num(d?.me?.goldens_hit),
      signHits: num(d?.me?.sign_hits),
      swings: num(d?.me?.swings),
    },
    field: num(d?.field ?? d?.me?.field),
    recent: ((d?.recent ?? []) as any[]).map(toSwingRow),
    sponsor: sp
      ? { name: sp.name ?? 'Our sponsor', logoUrl: sp.logo_url ?? null, color: sp.color ?? null, signBones: num(sp.sign_bones), signHits: num(sp.sign_hits), signCap: num(sp.sign_cap) || 5 }
      : null,
    canSwing: !!d?.can_swing,
    reason: d?.reason ?? null,
  };
}

export async function getDerbyLive(challengeId: string): Promise<DerbyLive> {
  return toDerbyLive(await rpc<any>('derby_live', { p_challenge_id: challengeId }));
}

// Auto (0257): the server swings at every pitch left, at ordinary timing.
export async function autoDerby(challengeId: string): Promise<{ swings: number; hrs: number; counts: number; longest: number }> {
  const d = await rpc<any>('derby_swing_auto', { p_challenge_id: challengeId });
  return { swings: num(d?.swings), hrs: num(d?.hrs), counts: num(d?.counts), longest: num(d?.longest) };
}

// The next pitch (the pending one again, if you haven't swung at it).
export async function throwDerbyPitch(challengeId: string, factor = 1): Promise<DerbyPitch> {
  return toPitch(await rpc<any>('derby_pitch', { p_challenge_id: challengeId }), factor);
}

export interface DerbySwing {
  result: DerbyResult;
  ft: number | null;
  dir: DerbyDir;
  moonshot: boolean;
  golden: boolean;
  sign: boolean;
  // A sign hit that paid (false once you're past the cap).
  signPaid: boolean;
  // Home runs this swing added (a Moonshot 2, golden doubles).
  counts: number;
  hrs: number;
  longestFt: number;
  rank: number | null;
  swingsLeft: number;
  message: string;
  // 0231: how far your tap was from the ball (half-widths), and the timing.
  miss: number | null;
  timing: number | null;
}

// timing: ms against the ball reaching the plate (− early, + late); null
// means you took it, which is an out in a derby. tap: where you tapped
// (0231), in half-widths of the zone.
export async function swingDerby(challengeId: string, timing: number | null, tap?: { x: number; y: number } | null): Promise<DerbySwing> {
  const t = timing == null ? null : Math.round(timing);
  const d = await rpc<any>(
    'derby_swing',
    t != null && tap
      ? { p_challenge_id: challengeId, p_timing_ms: t, p_tap_x: Math.round(tap.x * 1000) / 1000, p_tap_y: Math.round(tap.y * 1000) / 1000 }
      : { p_challenge_id: challengeId, p_timing_ms: t },
  );
  const result: DerbyResult = d?.result === 'hr' || d?.result === 'fly_out' || d?.result === 'take' ? d.result : 'whiff';
  const dir: DerbyDir = d?.dir === 'left' || d?.dir === 'right' ? d.dir : 'center';
  return {
    result,
    ft: numOrNull(d?.ft),
    dir,
    moonshot: !!d?.moonshot,
    golden: !!d?.golden,
    sign: !!d?.sign,
    signPaid: !!d?.sign_paid,
    counts: num(d?.counts),
    hrs: num(d?.hrs),
    longestFt: num(d?.longest_ft),
    rank: numOrNull(d?.rank),
    swingsLeft: num(d?.swings_left),
    message: d?.message ?? '',
    miss: numOrNull(d?.miss),
    timing: numOrNull(d?.timing),
  };
}

// ── The board ──

export type DerbyTab = 'top' | 'friends' | 'club';

export interface DerbyRow {
  pos: number | null;
  tied: boolean;
  userId: string;
  name: string;
  initials: string;
  iconId: string | null;
  frameId: string | null;
  backgroundId: string | null;
  hrs: number;
  longestFt: number;
  isMe: boolean;
  isFriend: boolean;
  isClub: boolean;
}

export interface DerbyPodium {
  place: number;
  tied: boolean;
  userId: string;
  name: string;
  initials: string;
  iconId: string | null;
  hrs: number;
  longestFt: number;
  bones: number;
}

export interface DerbyBoard {
  field: number;
  // How many have swung at all.
  swung: number;
  status: 'upcoming' | 'live' | 'final';
  dayNo: number;
  days: number;
  endsAt: string | null;
  joinClosesAt: string | null;
  joined: boolean;
  me: { pos: number | null; tied: boolean; hrs: number; longestFt: number; moved: number; moonshots: number; signHits: number } | null;
  rows: DerbyRow[];
  more: number | null;
  club: { id: string; name: string; playing: number } | null;
  longestToday: { name: string; ft: number } | null;
  longestWeek: { name: string; ft: number } | null;
  signHitsTotal: number;
  homeRunsTotal: number;
  signBones: number;
  signCap: number;
  prizes: { places: number[]; top10: number; longest: number; tenPlus: number };
  podium: DerbyPodium[];
  longestWinner: { name: string; ft: number; bones: number } | null;
  myBones: { place: number; longest: number; tenPlus: number; sign: number; total: number } | null;
  totals: { hrs: number; swings: number } | null;
}

const nameFt = (x: any) => (x ? { name: x.name ?? 'Someone', ft: num(x.ft) } : null);

export async function getDerbyBoard(challengeId: string, tab: DerbyTab = 'top'): Promise<DerbyBoard> {
  return toDerbyBoard(await rpc<any>('derby_board', { p_challenge_id: challengeId, p_tab: tab }));
}

export function toDerbyBoard(d: any): DerbyBoard {
  const m = d?.me;
  const pz = d?.prizes ?? {};
  const places = Array.isArray(pz) ? pz.map(num) : Array.isArray(pz.places) ? (pz.places as any[]).map(num) : [num(pz.first) || 500, num(pz.second) || 300, num(pz.third) || 200];
  const mb = d?.my_bones;
  // The longest home run's winners (a tie shares it): the first, with the
  // others' names joined on.
  const lws = (Array.isArray(d?.longest_winner) ? d.longest_winner : d?.longest_winner ? [d.longest_winner] : []) as any[];
  const lw = lws.length ? { name: lws.map((x) => x.name ?? 'Someone').join(' & '), ft: lws[0].ft, bones: lws[0].bones } : null;
  return {
    field: num(d?.field),
    swung: num(d?.swung),
    status: d?.status === 'final' || d?.status === 'live' ? d.status : 'upcoming',
    dayNo: num(d?.day_no),
    days: num(d?.days) || 7,
    endsAt: d?.ends_at ?? null,
    joinClosesAt: d?.join_closes_at ?? null,
    joined: !!d?.joined,
    me: m
      ? {
          pos: numOrNull(m.pos ?? m.rank),
          tied: !!m.tied,
          hrs: num(m.hrs),
          longestFt: num(m.longest_ft),
          moved: num(m.moved),
          moonshots: num(m.moonshots),
          signHits: num(m.sign_hits),
        }
      : null,
    rows: ((d?.rows ?? []) as any[]).map((r) => ({
      pos: numOrNull(r.pos ?? r.rank),
      tied: !!r.tied,
      userId: r.user_id,
      name: r.name ?? 'Someone',
      initials: r.initials ?? '?',
      iconId: r.icon_id ?? null,
      frameId: r.frame_id ?? null,
      backgroundId: r.background_id ?? null,
      hrs: num(r.hrs),
      longestFt: num(r.longest_ft),
      isMe: !!r.is_me,
      isFriend: !!r.is_friend,
      isClub: !!(r.in_club ?? r.is_club),
    })),
    more: numOrNull(d?.more),
    club: d?.club ? { id: d.club.id, name: d.club.name ?? 'Your club', playing: num(d.club.playing) } : null,
    longestToday: nameFt(d?.today_longest ?? d?.longest_today),
    longestWeek: nameFt(d?.week_longest ?? d?.longest_week),
    signHitsTotal: num(d?.sign_hits ?? d?.sign_hits_total),
    homeRunsTotal: num(d?.home_runs),
    signBones: num(d?.sign_bones),
    signCap: num(d?.sign_cap),
    prizes: {
      places,
      top10: Array.isArray(pz) ? 100 : num(pz.top10 ?? pz.top_10 ?? 100),
      longest: Array.isArray(pz) ? 150 : num(pz.longest ?? 150),
      tenPlus: Array.isArray(pz) ? 25 : num(pz.ten_hr ?? pz.ten_plus ?? 25),
    },
    podium: ((d?.podium ?? []) as any[]).map((p) => ({
      place: num(p.place),
      tied: !!p.tied,
      userId: p.user_id,
      name: p.name ?? 'Someone',
      initials: p.initials ?? '?',
      iconId: p.icon_id ?? null,
      hrs: num(p.hrs),
      longestFt: num(p.longest_ft),
      bones: num(p.bones),
    })),
    longestWinner: lw ? { name: lw.name ?? 'Someone', ft: num(lw.ft), bones: num(lw.bones) } : null,
    myBones: mb
      ? {
          place: num(mb.place_bones ?? mb.place),
          longest: num(mb.longest_bones ?? mb.longest),
          tenPlus: num(mb.ten_bones ?? mb.ten_plus),
          sign: num(mb.sign_bones ?? mb.sign),
          total: num(mb.total),
        }
      : null,
    totals: d?.totals ? { hrs: num(d.totals.hrs), swings: num(d.totals.swings) } : null,
  };
}

// "T41", "1", or "–" for someone who hasn't swung yet.
export function derbyPos(pos: number | null, tied: boolean): string {
  if (pos == null) return '–';
  return `${tied ? 'T' : ''}${pos}`;
}

// ── Admin ──

export interface DerbyPrizes {
  first: number;
  second: number;
  third: number;
  top10: number;
  longest: number;
  tenPlus: number;
}

export const DEFAULT_DERBY_PRIZES: DerbyPrizes = { first: 500, second: 300, third: 200, top10: 100, longest: 150, tenPlus: 25 };

// Admin only, right after publish_global_challenge: the prizes and the
// sponsor's sign (its Bones a hit and how many hits pay a person).
export async function setupGlobalDerby(challengeId: string, input: { prizes: DerbyPrizes; signBones: number; signCap: number }): Promise<void> {
  await rpc('derby_setup_global', {
    p_challenge_id: challengeId,
    p_prizes: {
      places: [input.prizes.first, input.prizes.second, input.prizes.third],
      top10: input.prizes.top10,
      longest: input.prizes.longest,
      ten_hr: input.prizes.tenPlus,
    },
    p_sign_bones: input.signBones,
    p_sign_cap: input.signCap,
  });
}

export interface DerbyOverview {
  live: number;
  all: number;
  joined: number;
  swung7d: number;
  swings7d: number;
  hrs7d: number;
  moonshots7d: number;
  goldenThrown7d: number;
  goldenHit7d: number;
  signHits7d: number;
  // All time: Bones sponsors paid for sign hits, and prize Bones paid.
  sponsorBonesAll: number;
  prizeBonesAll: number;
  avgHrs: number | null;
  longestEver: { name: string; ft: number } | null;
}

export async function getDerbyOverview(): Promise<DerbyOverview> {
  const d = await rpc<any>('admin_derby_overview');
  return {
    live: num(d?.live ?? d?.derbies_live),
    all: num(d?.all ?? d?.derbies_all),
    joined: num(d?.players ?? d?.joined),
    swung7d: num(d?.swung_7d ?? d?.players_swung_7d),
    swings7d: num(d?.swings_7d),
    hrs7d: num(d?.hrs_7d),
    moonshots7d: num(d?.moonshots_7d ?? d?.moonshots),
    goldenThrown7d: num(d?.golden_thrown_7d ?? d?.golden_thrown),
    goldenHit7d: num(d?.golden_hit_7d ?? d?.golden_hit),
    signHits7d: num(d?.sign_hits_7d ?? d?.sign_hits),
    sponsorBonesAll: num(d?.sponsor_bones_all),
    prizeBonesAll: num(d?.prize_bones_all),
    avgHrs: d?.avg_hrs == null ? null : Number(d.avg_hrs),
    longestEver: nameFt(d?.longest_ever),
  };
}

export function derbySummary(o: DerbyOverview): string {
  if (o.all === 0) return 'No Derby yet';
  return `${o.live} live · ${o.hrs7d.toLocaleString()} ${o.hrs7d === 1 ? 'home run' : 'home runs'} this week`;
}
