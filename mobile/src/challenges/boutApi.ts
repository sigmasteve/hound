import { supabase } from '../lib/supabase';

// Hound Bout (0224_bout_kind.sql, 0225_bout.sql): boxing, one on one, a
// round a day. Each 1,000 steps today is an action (up to 20, plus 2 after
// a cardio workout): throw a punch or slip one. A punch is timed on a
// meter (jab 1, hook 2, uppercut 3; the green narrows with the points)
// and meets the other's guard (high stops hooks, body stops uppercuts,
// counter catches jabs and hits back); a perfect one gets through
// anything. What gets through waits as "incoming" for the other to slip
// until the round's scored the next morning: points landed win the round
// 10-9, three power punches in a row put them down (two after a strength
// workout), three down in a round or four in the fight is a KO. The
// server decides everything.

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

// The Title Bout (0227) is fought in the same ring, through its own
// functions (tb_live, tb_throw, tb_slip, tb_set_guard).
export type BoutKind = 'bout' | 'titlebout';
const fn = (kind: BoutKind, name: string) => (kind === 'titlebout' ? 'tb_' : 'bout_') + name;

export type BoutPunchKind = 'jab' | 'hook' | 'up';
export type BoutGuard = 'high' | 'body' | 'counter';
export type BoutQuality = 'perfect' | 'clean' | 'miss';

export const PUNCHES: { id: BoutPunchKind; name: string; points: number }[] = [
  { id: 'jab', name: 'Jab', points: 1 },
  { id: 'hook', name: 'Hook', points: 2 },
  { id: 'up', name: 'Uppercut', points: 3 },
];
export const punchName = (p: BoutPunchKind) => PUNCHES.find((x) => x.id === p)?.name ?? 'Punch';

export const GUARDS: { id: BoutGuard; name: string; line: string }[] = [
  { id: 'high', name: 'High', line: 'Blocks hooks to the head. Uppercuts come up underneath it.' },
  { id: 'body', name: 'Body', line: 'Blocks uppercuts. Hooks get round it.' },
  { id: 'counter', name: 'Counter', line: 'Catches jabs and hits back for 1 each, but every other punch that gets through scores 1 more.' },
];

export interface BoutPunch {
  id: number;
  // The new ring (0230): its combination, place in it (counters 11+),
  // which side a hook came from, a Star punch, a counter, and how the
  // other hound moved ('left' | 'right' | 'duck' | 'back' | 'none').
  exchange: number | null;
  seq: number | null;
  side: 'L' | 'R' | null;
  star: boolean;
  counter: boolean;
  slipDir: string | null;
  by: string;
  round: number;
  punch: BoutPunchKind;
  quality: BoutQuality;
  blocked: boolean;
  countered: boolean;
  points: number;
  slip: 'slipped' | 'missed' | 'taken' | null;
  landed: boolean | null;
  knockdown: boolean;
  at: string;
}

export interface BoutRoundCard {
  round: number;
  mine: number;
  theirs: number;
  myPoints: number;
  theirPoints: number;
  myDown: number;
  theirDown: number;
  ko: boolean;
}

export interface BoutDay {
  steps: number;
  earned: number;
  used: number;
  left: number;
  nextAt: number | null;
  cardio: boolean;
  strength: boolean;
  camp: boolean;
  campWorkout: string | null;
  kdNeeds: number;
}

export interface BoutLive {
  status: 'active' | 'final';
  rounds: number;
  roundsPlayed: number;
  round: number;
  winner: string | null;
  method: 'ko' | 'decision' | 'draw' | null;
  koRound: number | null;
  me: string;
  opponent: { id: string; name: string; initials: string; iconId: string | null } | null;
  day: BoutDay;
  widths: Record<BoutPunchKind, number> & { perfectShare: number };
  slipWidths: Record<BoutPunchKind, number>;
  guard: BoutGuard;
  run: number;
  downs: number;
  tally: { mine: number; theirs: number };
  incoming: BoutPunch[];
  thrown: BoutPunch[];
  card: BoutRoundCard[];
  last: {
    round: number;
    mine: number;
    theirs: number;
    myPoints: number;
    theirPoints: number;
    myDown: number;
    theirDown: number;
    myLanded: Partial<Record<BoutPunchKind, number>>;
    slipped: number;
    theirThrough: number;
    theirGuard: BoutGuard | null;
  } | null;
  canAct: boolean;
  reason: string | null;
  // The new ring (0230): stars held (0-3) and combinations waiting to be faced.
  stars: number;
  combos: number;
  // The Title Bout's: which day of 7, and whether today's is the title fight.
  titleBout: { dayNo: number; title: boolean; opponentIsBot: boolean } | null;
}

export function toPunch(p: any): BoutPunch {
  return {
    id: num(p?.id),
    by: p?.by,
    round: num(p?.round),
    punch: (p?.punch ?? 'jab') as BoutPunchKind,
    quality: (p?.quality ?? 'clean') as BoutQuality,
    blocked: !!p?.blocked,
    countered: !!p?.countered,
    points: num(p?.points),
    slip: p?.slip ?? null,
    landed: p?.landed == null ? null : !!p.landed,
    knockdown: !!p?.knockdown,
    at: p?.at ?? '',
    exchange: p?.exchange == null ? null : num(p.exchange),
    seq: p?.seq == null ? null : num(p.seq),
    side: p?.side ?? null,
    star: !!p?.star,
    counter: !!p?.counter,
    slipDir: p?.slip_dir ?? null,
  };
}

export function toBoutLive(d: any): BoutLive {
  const dy = d?.day ?? {};
  const w = d?.widths ?? {};
  const sw = d?.slip_widths ?? {};
  const l = d?.last;
  return {
    status: d?.status === 'final' ? 'final' : 'active',
    rounds: num(d?.rounds) || 5,
    roundsPlayed: num(d?.rounds_played),
    round: num(d?.round),
    winner: d?.winner ?? null,
    method: d?.method ?? null,
    koRound: d?.ko_round == null ? null : num(d.ko_round),
    me: d?.me,
    opponent: d?.opponent
      ? { id: d.opponent.id, name: d.opponent.name ?? 'Your opponent', initials: d.opponent.initials ?? '?', iconId: d.opponent.icon_id ?? null }
      : null,
    day: {
      steps: num(dy.steps),
      earned: num(dy.earned),
      used: num(dy.used),
      left: num(dy.left),
      nextAt: dy.next_at == null ? null : num(dy.next_at),
      cardio: !!dy.cardio,
      strength: !!dy.strength,
      camp: !!dy.camp,
      campWorkout: dy.camp_workout ?? null,
      kdNeeds: num(dy.kd_needs) || 3,
    },
    widths: { jab: num(w.jab) || 14, hook: num(w.hook) || 9, up: num(w.up) || 5, perfectShare: num(w.perfect_share) || 0.35 },
    slipWidths: { jab: num(sw.jab) || 7, hook: num(sw.hook) || 10, up: num(sw.up) || 12 },
    guard: (d?.guard ?? 'high') as BoutGuard,
    run: num(d?.run),
    downs: num(d?.downs),
    tally: { mine: num(d?.tally?.mine), theirs: num(d?.tally?.theirs) },
    incoming: ((d?.incoming ?? []) as any[]).map(toPunch),
    thrown: ((d?.thrown ?? []) as any[]).map(toPunch),
    card: ((d?.card ?? []) as any[]).map((r) => ({
      round: num(r.round),
      mine: num(r.mine),
      theirs: num(r.theirs),
      myPoints: num(r.my_points),
      theirPoints: num(r.their_points),
      myDown: num(r.my_down),
      theirDown: num(r.their_down),
      ko: !!r.ko,
    })),
    last: l
      ? {
          round: num(l.round),
          mine: num(l.mine),
          theirs: num(l.theirs),
          myPoints: num(l.my_points),
          theirPoints: num(l.their_points),
          myDown: num(l.my_down),
          theirDown: num(l.their_down),
          myLanded: (l.my_landed ?? {}) as Partial<Record<BoutPunchKind, number>>,
          slipped: num(l.slipped),
          theirThrough: num(l.their_through),
          theirGuard: l.their_guard ?? null,
        }
      : null,
    canAct: !!d?.can_act,
    reason: d?.reason ?? null,
    stars: 0,
    combos: 0,
    titleBout: d?.tb
      ? { dayNo: num(d.tb.day_no), title: !!d.tb.fight?.title, opponentIsBot: !!d?.opponent && d.opponent.id == null }
      : null,
  };
}

export async function getBoutLive(challengeId: string, kind: BoutKind = 'bout'): Promise<BoutLive> {
  const [d, ring] = await Promise.all([rpc(fn(kind, 'live'), { p_challenge_id: challengeId }), getRingState(kind, challengeId)]);
  return withRing(toBoutLive(d), ring);
}

// ── The new ring (0230_bout_real_boxing.sql) ──
// 10 actions a day (one per 1,500 steps, 2 more after cardio). An action
// is an exchange: three openings light up on the opponent and you tap each
// as its ring closes (the spot picks the punch: face jab, side of the head
// hook, chin uppercut); or facing one of their combinations: each punch
// is telegraphed, and you move the right way (jab: either side; hook: away
// or duck; uppercut: lean back). A tight slip opens a counter (+2, a
// star); a star arms a Star punch (double). The server decides each result.

export type OpeningKind = 'jab' | 'hookL' | 'hookR' | 'up';
export type SlipDir = 'left' | 'right' | 'duck' | 'back';

export interface RingState {
  stars: number;
  combos: number;
}

export async function getRingState(kind: BoutKind, challengeId: string): Promise<RingState> {
  const d = await rpc<any>('ring_state', { p_game: kind, p_challenge_id: challengeId }).catch(() => null);
  return { stars: num(d?.stars), combos: num(d?.combos) };
}

export function withRing(live: BoutLive, ring: RingState): BoutLive {
  return { ...live, stars: ring.stars, combos: ring.combos };
}

export async function startExchange(kind: BoutKind, challengeId: string): Promise<{ id: number; openings: OpeningKind[]; stars: number }> {
  const d = await rpc<any>('ring_exchange_start', { p_game: kind, p_challenge_id: challengeId });
  return { id: num(d?.id), openings: ((d?.openings ?? []) as OpeningKind[]).slice(0, 3), stars: num(d?.stars) };
}

// Auto (0256): the server throws the exchanges you have left, every
// punch clean (never perfect, no stars).
export async function autoExchanges(
  kind: BoutKind,
  challengeId: string,
): Promise<{ exchanges: number; points: number; landed: number; blocked: number; left: number }> {
  const d = await rpc<any>('ring_exchange_auto', { p_game: kind, p_challenge_id: challengeId });
  return { exchanges: num(d?.exchanges), points: num(d?.points), landed: num(d?.landed), blocked: num(d?.blocked), left: num(d?.left) };
}

export interface RingPunchResult {
  seq: number;
  punch: BoutPunchKind;
  side: 'L' | 'R' | null;
  quality: BoutQuality;
  blocked: boolean;
  countered: boolean;
  points: number;
  star: boolean;
  stars: number;
  message: string;
}

// progress: how far the opening's ring had closed (0..1+), or null for a
// swing at the wrong spot or no tap.
export async function throwRingPunch(exchangeId: number, index: number, progress: number | null, star: boolean): Promise<RingPunchResult> {
  const d = await rpc<any>('ring_exchange_punch', {
    p_exchange_id: exchangeId,
    p_index: index,
    p_progress: progress == null ? null : Math.round(progress * 1000) / 1000,
    p_star: star,
  });
  return {
    seq: num(d?.seq),
    punch: (d?.punch ?? 'jab') as BoutPunchKind,
    side: d?.side ?? null,
    quality: (d?.quality ?? 'miss') as BoutQuality,
    blocked: !!d?.blocked,
    countered: !!d?.countered,
    points: num(d?.points),
    star: !!d?.star,
    stars: num(d?.stars),
    message: d?.message ?? '',
  };
}

export interface IncomingPunch {
  seq: number;
  punch: BoutPunchKind;
  side: 'L' | 'R' | null;
  points: number;
  star: boolean;
}

export async function startDefense(kind: BoutKind, challengeId: string): Promise<{ id: number; from: string; stars: number; punches: IncomingPunch[] }> {
  const d = await rpc<any>('ring_defend_start', { p_game: kind, p_challenge_id: challengeId });
  return {
    id: num(d?.id),
    from: d?.from ?? 'Your opponent',
    stars: num(d?.stars),
    punches: ((d?.punches ?? []) as any[]).map((p) => ({ seq: num(p.seq), punch: (p.punch ?? 'jab') as BoutPunchKind, side: p.side ?? null, points: num(p.points), star: !!p.star })),
  };
}

export async function finishDefense(
  exchangeId: number,
  moves: ({ dir: SlipDir; dt: number } | null)[],
  counters: number,
): Promise<{ slipped: boolean[]; counters: number; stars: number; message: string }> {
  const d = await rpc<any>('ring_defend_finish', { p_exchange_id: exchangeId, p_moves: moves, p_counters: counters });
  return {
    slipped: ((d?.results ?? []) as any[]).map((r) => !!r.slipped),
    counters: num(d?.counters),
    stars: num(d?.stars),
    message: d?.message ?? '',
  };
}

// Moving the right way (the server's ring_dodge_ok): a jab, either side;
// an uppercut, lean back; a hook from their left hand (side 'L', coming
// at your right), slip left or duck, and from the right, slip right or duck.
export function dodgeOk(punch: BoutPunchKind, side: 'L' | 'R' | null, dir: SlipDir): boolean {
  if (punch === 'jab') return dir === 'left' || dir === 'right';
  if (punch === 'up') return dir === 'back';
  return side === 'L' ? dir === 'left' || dir === 'duck' : dir === 'right' || dir === 'duck';
}

export interface RingOverview {
  exchanges7d: number;
  attackers7d: number;
  attackersEver: number;
  defenses7d: number;
  defenders7d: number;
  slipped7d: number;
  faced7d: number;
  counters7d: number;
  starPunches7d: number;
  comboKnockdowns7d: number;
}

export async function getRingOverview(): Promise<RingOverview> {
  const d = await rpc<any>('admin_ring_overview');
  return {
    exchanges7d: num(d?.exchanges_7d),
    attackers7d: num(d?.attackers_7d),
    attackersEver: num(d?.attackers_ever),
    defenses7d: num(d?.defenses_7d),
    defenders7d: num(d?.defenders_7d),
    slipped7d: num(d?.slipped_7d),
    faced7d: num(d?.faced_7d),
    counters7d: num(d?.counters_7d),
    starPunches7d: num(d?.star_punches_7d),
    comboKnockdowns7d: num(d?.combo_knockdowns_7d),
  };
}

export interface BoutThrow {
  id: number;
  punch: BoutPunchKind;
  quality: BoutQuality;
  blocked: boolean;
  countered: boolean;
  points: number;
  guard: BoutGuard | null;
  run: number;
  downs: number;
  kdNeeds: number;
  left: number;
  message: string;
}

// pos: where the meter stopped, 0-100 (50 the middle).
export async function throwPunch(challengeId: string, punch: BoutPunchKind, pos: number, kind: BoutKind = 'bout'): Promise<BoutThrow> {
  const d = await rpc<any>(fn(kind, 'throw'), { p_challenge_id: challengeId, p_punch: punch, p_pos: Math.round(pos * 10) / 10 });
  return {
    id: num(d?.id),
    punch: (d?.punch ?? punch) as BoutPunchKind,
    quality: (d?.quality ?? 'miss') as BoutQuality,
    blocked: !!d?.blocked,
    countered: !!d?.countered,
    points: num(d?.points),
    guard: d?.guard ?? null,
    run: num(d?.run),
    downs: num(d?.downs),
    kdNeeds: num(d?.kd_needs) || 3,
    left: num(d?.left),
    message: d?.message ?? '',
  };
}

// Slip an incoming punch (pos 0-100), or take it (null: no action spent).
export async function slipPunch(
  challengeId: string,
  punchId: number,
  pos: number | null,
  kind: BoutKind = 'bout',
): Promise<{ slip: 'slipped' | 'missed' | 'taken'; left: number; message: string }> {
  const d = await rpc<any>(fn(kind, 'slip'), { p_challenge_id: challengeId, p_punch_id: punchId, p_pos: pos == null ? null : Math.round(pos * 10) / 10 });
  return { slip: d?.slip ?? 'taken', left: num(d?.left), message: d?.message ?? '' };
}

export async function setGuard(challengeId: string, guard: BoutGuard, kind: BoutKind = 'bout'): Promise<void> {
  await rpc(fn(kind, 'set_guard'), { p_challenge_id: challengeId, p_guard: guard });
}

export async function setupBout(challengeId: string, rounds: number): Promise<void> {
  await rpc('bout_setup', { p_challenge_id: challengeId, p_rounds: rounds });
}

export interface BoutReplay {
  round: number;
  me: string;
  punches: BoutPunch[];
}

export async function getBoutReplay(challengeId: string, round: number): Promise<BoutReplay> {
  const d = await rpc<any>('bout_replay', { p_challenge_id: challengeId, p_round: round });
  return { round: num(d?.round), me: d?.me, punches: ((d?.punches ?? []) as any[]).map(toPunch) };
}

// ── Admin ──

export interface BoutOverview {
  live: number;
  all: number;
  fighters: number;
  threwEver: number;
  threw7d: number;
  punches7d: number;
  byPunch7d: Partial<Record<BoutPunchKind, number>>;
  missed7d: number;
  blocked7d: number;
  perfect7d: number;
  slipsTried7d: number;
  slipped7d: number;
  knockdownsAll: number;
  byMethod: Partial<Record<'ko' | 'decision' | 'draw', number>>;
  guards7d: Partial<Record<BoutGuard, number>>;
}

export async function getBoutOverview(): Promise<BoutOverview> {
  const d = await rpc<any>('admin_bout_overview');
  return {
    live: num(d?.fights_live),
    all: num(d?.fights_all),
    fighters: num(d?.fighters_all),
    threwEver: num(d?.threw_ever),
    threw7d: num(d?.threw_7d),
    punches7d: num(d?.punches_7d),
    byPunch7d: d?.by_punch_7d ?? {},
    missed7d: num(d?.missed_7d),
    blocked7d: num(d?.blocked_7d),
    perfect7d: num(d?.perfect_7d),
    slipsTried7d: num(d?.slips_tried_7d),
    slipped7d: num(d?.slipped_7d),
    knockdownsAll: num(d?.knockdowns_all),
    byMethod: d?.by_method ?? {},
    guards7d: d?.guards_7d ?? {},
  };
}

export function boutSummary(o: BoutOverview): string {
  if (o.all === 0) return 'No fights yet';
  return `${o.live} live · ${o.threw7d.toLocaleString()} throwing this week · ${o.knockdownsAll.toLocaleString()} knockdowns`;
}
