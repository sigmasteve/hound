import { supabase } from '../lib/supabase';
import { getRingState, toBoutLive, toPunch, withRing, type BoutLive, type BoutPunchKind, type BoutGuard, type BoutReplay } from './boutApi';

// The Title Bout (0226_titlebout_kind.sql, 0227_titlebout.sql): a Global
// Hound Bout for the belt. Seven days: on days 1-5 everyone fights a new
// opponent a day, matched by the ladder (a KO win 3, a win on points 2, a
// draw 1; ties go to knockdowns, then points landed), one Hound Bout round
// each, scored the next morning; the odd one out spars a sparring hound.
// Then the top two fight two rounds for the belt (days 6 and 7) while
// everyone else keeps fighting the ladder, and anyone in it can pick a
// champion for free from the tale of the tape: a right pick earns Admin's
// pick Bones, double on the underdog (the side fewer picked). The
// champion's hound gets the Title Bout Belt. In the ring it's the Hound
// Bout's screen (BoutRingScreen with kind 'titlebout').

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

export interface TitlePrizes {
  champion: number;
  runnerUp: number;
  top10: number;
  mostKos: number;
  fiveDays: number;
}

export const DEFAULT_TITLE_PRIZES: TitlePrizes = { champion: 500, runnerUp: 250, top10: 100, mostKos: 150, fiveDays: 25 };

export interface TitleLadderRow {
  pos: number;
  userId: string;
  name: string;
  initials: string;
  iconId: string | null;
  wins: number;
  losses: number;
  draws: number;
  kos: number;
  pts: number;
  isMe: boolean;
  title: boolean;
}

// One side of the tale of the tape (days 1-5's ladder fights).
export interface TitleTape {
  id: string;
  name: string;
  initials: string;
  iconId: string | null;
  pos: number;
  pts: number;
  wins: number;
  losses: number;
  draws: number;
  kos: number;
  downsAgainst: number;
  thrown: number;
  landed: number;
  slipsTried: number;
  slipped: number;
  bestPunch: BoutPunchKind | null;
  guard: BoutGuard | null;
  stepsADay: number | null;
  strengthDays: number;
}

export interface TitleRound {
  round: number;
  a: number | null;
  b: number | null;
  aDown: number | null;
  bDown: number | null;
  scored: boolean;
  fightId: number;
}

export interface TitleBout {
  dayNo: number;
  days: number;
  phase: 'upcoming' | 'ladder' | 'title' | 'final';
  joined: boolean;
  field: number;
  fight: { id: number; title: boolean; round: number; oppPos: number | null; oppPts: number | null } | null;
  me: { pos: number; pts: number; wins: number; losses: number; draws: number; kos: number; daysFought: number } | null;
  lastFight: { id: number; day: string; title: boolean; opp: string; won: boolean; draw: boolean; ko: boolean; mine: number; theirs: number } | null;
  ladder: TitleLadderRow[];
  title: {
    a: TitleTape;
    b: TitleTape;
    rounds: TitleRound[];
    winner: string | null;
    method: 'ko' | 'decision' | 'draw' | null;
    koRound: number | null;
    mine: boolean;
  } | null;
  picks: { open: boolean; mine: string | null; correct: boolean | null; wonBones: number; a: number; b: number; reward: number } | null;
  prizes: TitlePrizes;
  pickBones: number;
  sponsor: { name: string; color: string | null } | null;
}

function toTape(t: any): TitleTape {
  return {
    id: t?.id,
    name: t?.name ?? 'A hound',
    initials: t?.initials ?? '?',
    iconId: t?.icon_id ?? null,
    pos: num(t?.pos),
    pts: num(t?.pts),
    wins: num(t?.wins),
    losses: num(t?.losses),
    draws: num(t?.draws),
    kos: num(t?.kos),
    downsAgainst: num(t?.downs_against),
    thrown: num(t?.thrown),
    landed: num(t?.landed),
    slipsTried: num(t?.slips_tried),
    slipped: num(t?.slipped),
    bestPunch: t?.best_punch ?? null,
    guard: t?.guard ?? null,
    stepsADay: t?.steps_a_day == null ? null : num(t.steps_a_day),
    strengthDays: num(t?.strength_days),
  };
}

export function toPrizes(p: any): TitlePrizes {
  return {
    champion: num(p?.champion ?? DEFAULT_TITLE_PRIZES.champion),
    runnerUp: num(p?.runner_up ?? DEFAULT_TITLE_PRIZES.runnerUp),
    top10: num(p?.top10 ?? DEFAULT_TITLE_PRIZES.top10),
    mostKos: num(p?.most_kos ?? DEFAULT_TITLE_PRIZES.mostKos),
    fiveDays: num(p?.five_days ?? DEFAULT_TITLE_PRIZES.fiveDays),
  };
}

export function toTitleBout(d: any): TitleBout {
  const tb = d?.tb ?? {};
  const t = tb.title;
  const k = tb.picks;
  return {
    dayNo: num(tb.day_no),
    days: num(tb.days) || 7,
    phase: (['upcoming', 'ladder', 'title', 'final'].includes(tb.phase) ? tb.phase : 'ladder') as TitleBout['phase'],
    joined: !!tb.joined,
    field: num(tb.field),
    fight: tb.fight
      ? { id: num(tb.fight.id), title: !!tb.fight.title, round: num(tb.fight.round) || 1, oppPos: tb.fight.opp_pos == null ? null : num(tb.fight.opp_pos), oppPts: tb.fight.opp_pts == null ? null : num(tb.fight.opp_pts) }
      : null,
    me: tb.me
      ? { pos: num(tb.me.pos), pts: num(tb.me.pts), wins: num(tb.me.wins), losses: num(tb.me.losses), draws: num(tb.me.draws), kos: num(tb.me.kos), daysFought: num(tb.me.days_fought) }
      : null,
    lastFight: tb.last_fight
      ? {
          id: num(tb.last_fight.id),
          day: tb.last_fight.day,
          title: !!tb.last_fight.title,
          opp: tb.last_fight.opp ?? 'your opponent',
          won: !!tb.last_fight.won,
          draw: !!tb.last_fight.draw,
          ko: !!tb.last_fight.ko,
          mine: num(tb.last_fight.mine),
          theirs: num(tb.last_fight.theirs),
        }
      : null,
    ladder: ((tb.ladder ?? []) as any[]).map((r) => ({
      pos: num(r.pos),
      userId: r.user_id,
      name: r.name ?? 'A hound',
      initials: r.initials ?? '?',
      iconId: r.icon_id ?? null,
      wins: num(r.wins),
      losses: num(r.losses),
      draws: num(r.draws),
      kos: num(r.kos),
      pts: num(r.pts),
      isMe: !!r.is_me,
      title: !!r.title,
    })),
    title: t
      ? {
          a: toTape(t.a),
          b: toTape(t.b),
          rounds: ((t.rounds ?? []) as any[]).map((r) => ({
            round: num(r.round),
            a: r.a == null ? null : num(r.a),
            b: r.b == null ? null : num(r.b),
            aDown: r.a_down == null ? null : num(r.a_down),
            bDown: r.b_down == null ? null : num(r.b_down),
            scored: !!r.scored,
            fightId: num(r.fight_id),
          })),
          winner: t.winner ?? null,
          method: t.method ?? null,
          koRound: t.ko_round == null ? null : num(t.ko_round),
          mine: !!t.mine,
        }
      : null,
    picks: k
      ? { open: !!k.open, mine: k.mine ?? null, correct: k.correct ?? null, wonBones: num(k.won_bones), a: num(k.a), b: num(k.b), reward: num(k.reward) }
      : null,
    prizes: toPrizes(tb.prizes),
    pickBones: num(tb.pick_bones),
    sponsor: tb.sponsor ? { name: tb.sponsor.name, color: tb.sponsor.color ?? null } : null,
  };
}

// The fight (for the ring's numbers) and the Title Bout's own state, in one call.
export async function getTitleBout(challengeId: string): Promise<{ live: BoutLive; tb: TitleBout }> {
  const [d, ring] = await Promise.all([rpc<any>('tb_live', { p_challenge_id: challengeId }), getRingState('titlebout', challengeId)]);
  return { live: withRing(toBoutLive(d), ring), tb: toTitleBout(d) };
}

export async function pickChampion(challengeId: string, userId: string): Promise<{ a: number; b: number }> {
  const d = await rpc<any>('tb_pick', { p_challenge_id: challengeId, p_pick: userId });
  return { a: num(d?.a), b: num(d?.b) };
}

export async function getTitleReplay(challengeId: string, fightId: number): Promise<BoutReplay> {
  const d = await rpc<any>('tb_replay', { p_challenge_id: challengeId, p_fight: fightId });
  return { round: num(d?.round), me: d?.me, punches: ((d?.punches ?? []) as any[]).map(toPunch) };
}

export async function setupTitleBoutGlobal(challengeId: string, prizes: TitlePrizes, pickBones: number): Promise<void> {
  await rpc('titlebout_setup_global', {
    p_challenge_id: challengeId,
    p_prizes: { champion: prizes.champion, runner_up: prizes.runnerUp, top10: prizes.top10, most_kos: prizes.mostKos, five_days: prizes.fiveDays },
    p_pick_bones: pickBones,
  });
}

// The prize table on the challenge page.
export function titlePrizeRows(p: TitlePrizes, pickBones: number, currency: string): { label: string; value: string }[] {
  const b = (n: number) => `${n.toLocaleString()} ${currency}`;
  return [
    { label: 'Champion', value: b(p.champion) },
    { label: 'Runner-up', value: b(p.runnerUp) },
    { label: '3rd to 10th', value: b(p.top10) },
    { label: 'Most KOs', value: b(p.mostKos) },
    { label: 'Fought 5+ days', value: b(p.fiveDays) },
    { label: 'Picked the champion', value: `${b(pickBones)} (double on the underdog)` },
  ].filter((r) => !r.value.startsWith('0 '));
}

// ── Admin ──

export interface TitleBoutOverview {
  live: number;
  all: number;
  joined: number;
  foughtEver: number;
  fought7d: number;
  fights7d: number;
  kos7d: number;
  sparring7d: number;
  punches7d: number;
  cameBack: number | null;
  fiveDays: number;
  picks: number;
  picksRight: number;
  champions: { name: string; method: string; challenge: string }[];
}

export async function getTitleBoutOverview(): Promise<TitleBoutOverview> {
  const d = await rpc<any>('admin_titlebout_overview');
  return {
    live: num(d?.live),
    all: num(d?.all),
    joined: num(d?.joined),
    foughtEver: num(d?.fought_ever),
    fought7d: num(d?.fought_7d),
    fights7d: num(d?.fights_7d),
    kos7d: num(d?.kos_7d),
    sparring7d: num(d?.sparring_7d),
    punches7d: num(d?.punches_7d),
    cameBack: d?.came_back == null ? null : num(d.came_back),
    fiveDays: num(d?.five_days),
    picks: num(d?.picks),
    picksRight: num(d?.picks_right),
    champions: ((d?.champions ?? []) as any[]).map((c) => ({ name: c.name ?? 'A hound', method: c.method ?? '', challenge: c.challenge ?? '' })),
  };
}

export function titleBoutSummary(o: TitleBoutOverview): string {
  if (o.all === 0) return 'No Title Bouts yet';
  return `${o.live} live · ${o.fought7d.toLocaleString()} fighting this week · ${o.picks.toLocaleString()} picks`;
}
