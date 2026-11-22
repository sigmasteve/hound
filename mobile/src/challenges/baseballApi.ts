import { supabase } from '../lib/supabase';
import type { BaseballApproach, BaseballPlayKind, BaseballPos, BaseballZone } from './baseball';

// The client-facing half of Baseball — see 0167_baseball.sql for the
// schema and RPCs this wraps. Same shape as cricketApi.ts.

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export type BaseballTeam = 'a' | 'b';

export interface BaseballPlayer {
  playerId: string;
  userId: string | null;
  botId: string | null;
  team: BaseballTeam;
  // Batting order within the side, from 1.
  seat: number;
  positions: BaseballPos[];
  joined: boolean;
}

export interface BaseballGame {
  challengeId: string;
  innings: number;
  homeTeam: BaseballTeam;
  // The next inning to play.
  inning: number;
  runsA: number;
  runsB: number;
  hitsA: number;
  hitsB: number;
  status: 'active' | 'final';
  winnerTeam: BaseballTeam | null;
  players: BaseballPlayer[];
  // 0207: everyone takes their own at-bats during the day (Create's "Take
  // my own at-bats"); the game uses them when their turn comes.
  handsOn: boolean;
}

export interface BaseballInning {
  inning: number;
  day: string;
  awayRuns: number;
  awayHits: number;
  // Null when the bottom half wasn't needed.
  homeRuns: number | null;
  homeHits: number | null;
}

export interface BaseballPlay {
  id: string;
  day: string;
  inning: number;
  half: 'top' | 'bottom';
  seq: number;
  battingTeam: BaseballTeam;
  kind: BaseballPlayKind;
  batterId: string | null;
  pitcherId: string | null;
  fielderId: string | null;
  fielderPos: BaseballPos | null;
  runnerId: string | null;
  aim: BaseballZone | null;
  shifted: boolean | null;
  lateThrow: boolean;
  runs: number;
  outs: number;
  onFirst: string | null;
  onSecond: string | null;
  onThird: string | null;
  batterSteps: number | null;
  pitcherSteps: number | null;
  fielderSteps: number | null;
  catcherSteps: number | null;
  runnerSteps: number | null;
  // 0231: a steal run on a jump taken by hand (ms after the leg kick).
  stealJump?: number | null;
  // Batted by hand on the batting screen (0207), and the plays that
  // followed from it in the same at-bat.
  byHand: boolean;
}

export interface BaseballPicks {
  aim: BaseballZone | null;
  shift: BaseballZone | null;
  approach: BaseballApproach | null;
  steal: boolean;
}

export const NO_PICKS: BaseballPicks = { aim: null, shift: null, approach: null, steal: false };

export function otherTeam(team: BaseballTeam): BaseballTeam {
  return team === 'a' ? 'b' : 'a';
}

export function baseballTeamOf(game: BaseballGame, playerId: string | null | undefined): BaseballTeam | null {
  return game.players.find((p) => p.playerId === playerId)?.team ?? null;
}

export function baseballSide(game: BaseballGame, team: BaseballTeam): BaseballPlayer[] {
  return game.players.filter((p) => p.team === team).sort((a, b) => a.seat - b.seat);
}

export function holderOf(game: BaseballGame, team: BaseballTeam, pos: BaseballPos): BaseballPlayer | undefined {
  return baseballSide(game, team).find((p) => p.positions.includes(pos));
}

export function awayTeam(game: BaseballGame): BaseballTeam {
  return otherTeam(game.homeTeam);
}

// Null when the game was never set up (baseball_setup failed after the
// challenge itself was created).
export async function getBaseballGame(challengeId: string): Promise<BaseballGame | null> {
  const preview = (globalThis as any).__previewBaseball;
  if (preview?.game) return preview.game as BaseballGame;
  const client = requireClient();
  const [{ data, error }, { data: playerRows, error: playersError }] = await Promise.all([
    client.from('baseball_games').select('*').eq('challenge_id', challengeId).maybeSingle(),
    client.from('baseball_players').select('user_id, bot_id, team, seat, positions, joined').eq('challenge_id', challengeId),
  ]);
  if (error) throw new Error(error.message);
  if (playersError) throw new Error(playersError.message);
  if (!data) return null;
  return {
    challengeId: data.challenge_id,
    innings: data.innings,
    homeTeam: data.home_team as BaseballTeam,
    inning: data.inning,
    runsA: data.runs_a,
    runsB: data.runs_b,
    hitsA: data.hits_a,
    hitsB: data.hits_b,
    status: data.status as 'active' | 'final',
    winnerTeam: (data.winner_team as BaseballTeam | null) ?? null,
    handsOn: !!data.hands_on,
    players: (playerRows ?? []).map((r: any) => ({
      playerId: (r.user_id ?? r.bot_id) as string,
      userId: r.user_id ?? null,
      botId: r.bot_id ?? null,
      team: r.team as BaseballTeam,
      seat: r.seat,
      positions: (r.positions ?? []) as BaseballPos[],
      joined: !!r.joined,
    })),
  };
}

export async function listBaseballInnings(challengeId: string): Promise<BaseballInning[]> {
  const preview = (globalThis as any).__previewBaseball;
  if (preview?.innings) return preview.innings as BaseballInning[];
  const { data, error } = await requireClient()
    .from('baseball_innings')
    .select('inning, day, away_runs, away_hits, home_runs, home_hits')
    .eq('challenge_id', challengeId)
    .order('inning', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    inning: r.inning,
    day: r.day,
    awayRuns: r.away_runs,
    awayHits: r.away_hits,
    homeRuns: r.home_runs ?? null,
    homeHits: r.home_hits ?? null,
  }));
}

export async function listBaseballPlays(challengeId: string): Promise<BaseballPlay[]> {
  const preview = (globalThis as any).__previewBaseball;
  if (preview?.plays) return preview.plays as BaseballPlay[];
  const { data, error } = await requireClient()
    .from('baseball_plays')
    .select('*')
    .eq('challenge_id', challengeId)
    .order('inning', { ascending: true })
    .order('half', { ascending: false })
    .order('seq', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    day: r.day,
    inning: r.inning,
    half: r.half,
    seq: r.seq,
    battingTeam: r.batting_team as BaseballTeam,
    kind: r.kind as BaseballPlayKind,
    batterId: r.batter_id ?? null,
    pitcherId: r.pitcher_id ?? null,
    fielderId: r.fielder_id ?? null,
    fielderPos: (r.fielder_pos ?? null) as BaseballPos | null,
    runnerId: r.runner_id ?? null,
    aim: (r.aim ?? null) as BaseballZone | null,
    shifted: r.shifted ?? null,
    lateThrow: !!r.late_throw,
    runs: r.runs ?? 0,
    outs: r.outs ?? 0,
    onFirst: r.on_first ?? null,
    onSecond: r.on_second ?? null,
    onThird: r.on_third ?? null,
    batterSteps: r.batter_steps ?? null,
    pitcherSteps: r.pitcher_steps ?? null,
    fielderSteps: r.fielder_steps ?? null,
    catcherSteps: r.catcher_steps ?? null,
    runnerSteps: r.runner_steps ?? null,
    byHand: !!r.by_hand,
    stealJump: r.steal_jump == null ? null : Number(r.steal_jump),
  }));
}

// Your own picks for a day ('YYYY-MM-DD', your local today).
export async function getMyBaseballPicks(challengeId: string, userId: string, day: string): Promise<BaseballPicks> {
  const preview = (globalThis as any).__previewBaseball;
  if (preview?.picks) return preview.picks as BaseballPicks;
  const { data, error } = await requireClient()
    .from('baseball_picks')
    .select('aim, shift, approach, steal')
    .eq('challenge_id', challengeId)
    .eq('player_id', userId)
    .eq('day', day)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return NO_PICKS;
  return {
    aim: (data.aim ?? null) as BaseballZone | null,
    shift: (data.shift ?? null) as BaseballZone | null,
    approach: (data.approach ?? null) as BaseballApproach | null,
    steal: !!data.steal,
  };
}

export type BaseballPickField = 'aim' | 'shift' | 'approach' | 'steal';

// Sets one of your picks for your today; null clears it. Steal takes
// 'on' or 'off'.
export async function setBaseballPick(challengeId: string, field: BaseballPickField, value: string | null): Promise<void> {
  const { error } = await requireClient().rpc('baseball_set_pick', { p_challenge_id: challengeId, p_field: field, p_value: value });
  if (error) throw new Error(error.message);
}

export interface BaseballSeat {
  id: string;
  team: BaseballTeam;
}

// The creator stores both sides right after creating the challenge, in
// batting order. Positions follow from the order.
export async function setupBaseball(challengeId: string, seats: BaseballSeat[], opts?: { handsOn?: boolean }): Promise<void> {
  // p_hands_on (0207) only when it's on, so a server without it still
  // takes the call.
  const args: Record<string, unknown> = { p_challenge_id: challengeId, p_players: seats };
  if (opts?.handsOn) args.p_hands_on = true;
  const { error } = await requireClient().rpc('baseball_setup', args);
  if (error) throw new Error(error.message);
}

export async function addBaseballPlayer(challengeId: string, userId: string, team: BaseballTeam): Promise<void> {
  const { error } = await requireClient().rpc('baseball_add_player', { p_challenge_id: challengeId, p_user_id: userId, p_team: team });
  if (error) throw new Error(error.message);
}

// Plays every inning that's due. Safe to call any time.
export async function advanceBaseball(challengeId: string): Promise<number> {
  if ((globalThis as any).__previewBaseball) return 0;
  const { data, error } = await requireClient().rpc('baseball_advance', { p_challenge_id: challengeId });
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}

// Admin → Baseball (0167).
export interface BaseballOverview {
  active: number;
  finished: number;
  extraInnings: number;
  ties: number;
  players: number;
  seats: number;
  botSeats: number;
  avgRuns: number;
  homeRuns: number;
  stolenBases: number;
  caughtStealing: number;
  doublePlays: number;
  picks7d: { aim: number; shift: number; approach: number; steal: number };
  pickers7d: number;
  // 0207: at-bats taken by hand.
  live: {
    gamesHandsOn: number;
    people7d: number;
    atBats7d: number;
    pitches7d: number;
    avg7d: number | null;
    autoAvg7d: number | null;
    hr7d: number;
    // 0231: where they tapped, the curveball, the mound and steal jumps.
    tapped7d: number;
    avgMiss7d: number | null;
    curveballs7d: number;
    pitchers7d: number;
    pitched7d: number;
    pitchedK7d: number;
    pitchedHits7d: number;
    painted7d: number;
    moundPitches7d: number;
    jumps7d: number;
    greatJumps7d: number;
    jumpSteals7d: number;
    jumpSafe7d: number;
    derbyTapped7d: number;
    // 0245: swung with the meter (timing only) or by tapping the ball.
    metered7d: number;
    derbyMetered7d: number;
    meterPeople7d: number;
    tapPeople7d: number;
  } | null;
}

export async function getBaseballOverview(): Promise<BaseballOverview> {
  const { data, error } = await requireClient().rpc('admin_baseball_overview');
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as any;
  const n = (v: unknown) => Number(v ?? 0);
  return {
    active: n(d.active),
    finished: n(d.finished),
    extraInnings: n(d.extra_innings),
    ties: n(d.ties),
    players: n(d.players),
    seats: n(d.seats),
    botSeats: n(d.bot_seats),
    avgRuns: n(d.avg_runs),
    homeRuns: n(d.home_runs),
    stolenBases: n(d.stolen_bases),
    caughtStealing: n(d.caught_stealing),
    doublePlays: n(d.double_plays),
    picks7d: { aim: n(d.picks_7d?.aim), shift: n(d.picks_7d?.shift), approach: n(d.picks_7d?.approach), steal: n(d.picks_7d?.steal) },
    pickers7d: n(d.pickers_7d),
    live: d.live
      ? {
          gamesHandsOn: n(d.live.games_hands_on),
          people7d: n(d.live.people_7d),
          atBats7d: n(d.live.at_bats_7d),
          pitches7d: n(d.live.pitches_7d),
          avg7d: d.live.avg_7d == null ? null : Number(d.live.avg_7d),
          autoAvg7d: d.live.auto_avg_7d == null ? null : Number(d.live.auto_avg_7d),
          hr7d: n(d.live.hr_7d),
          tapped7d: n(d.live.tapped_7d),
          avgMiss7d: d.live.avg_miss_7d == null ? null : Number(d.live.avg_miss_7d),
          curveballs7d: n(d.live.curveballs_7d),
          pitchers7d: n(d.live.pitchers_7d),
          pitched7d: n(d.live.pitched_7d),
          pitchedK7d: n(d.live.pitched_k_7d),
          pitchedHits7d: n(d.live.pitched_hits_7d),
          painted7d: n(d.live.painted_7d),
          moundPitches7d: n(d.live.mound_pitches_7d),
          jumps7d: n(d.live.jumps_7d),
          greatJumps7d: n(d.live.great_jumps_7d),
          jumpSteals7d: n(d.live.jump_steals_7d),
          jumpSafe7d: n(d.live.jump_safe_7d),
          derbyTapped7d: n(d.live.derby_tapped_7d),
          metered7d: n(d.live.metered_7d),
          derbyMetered7d: n(d.live.derby_metered_7d),
          meterPeople7d: n(d.live.meter_people_7d),
          tapPeople7d: n(d.live.tap_people_7d),
        }
      : null,
  };
}

// ── Taking your own at-bats (0207) ──

export type BaseballContact = 'barrel' | 'solid' | 'weak';
export type BaseballPitchKind = 'fastball' | 'changeup' | 'curveball';
export type BaseballCall = 'ball' | 'strike' | 'foul' | 'whiff' | 'in_play';
export type BaseballLiveResult = 'strikeout' | 'walk' | 'home_run' | 'single' | 'double' | 'triple' | 'ground_out' | 'fly_out';

export interface BaseballPitch {
  kind: BaseballPitchKind;
  mph: number;
  inZone: boolean;
  // How long the ball takes from the pitcher's hand to the zone.
  ms: number;
  // 0231: where it crosses, in half-widths of the zone (|px|, |py| <= 1
  // is in it; px + toward the batter's side... right as you look, py + up).
  px: number;
  py: number;
}

export interface BaseballLiveAtBat {
  n: number;
  day: string;
  result: BaseballLiveResult;
  contact: BaseballContact | null;
  aim: BaseballZone | null;
  fielderPos: BaseballPos | null;
  pitches: number;
  // Used by the game (in `inning`), or waiting for your turn in the order.
  used: boolean;
  inning: number | null;
}

export interface BaseballLive {
  handsOn: boolean;
  canBat: boolean;
  // Why not, in the server's sentence: shown as is.
  reason: string | null;
  day: string | null;
  inning: number;
  team: BaseballTeam | null;
  steps: number;
  abSteps: number;
  earned: number;
  taken: number;
  waiting: number;
  ready: number;
  // Steps at which the next at-bat comes; null at the day's cap (6,
  // shared with pitching since 0231).
  nextAt: number | null;
  cap: number;
  // Pitched at-bats waiting for their batters (0231).
  pitchedWaiting: number;
  // Today's steal jump (0231), once set.
  stealJump: BaseballStealJump | null;
  pitcher: { name: string; steps: number } | null;
  pressure: number;
  // The timing bands, in ms either side of the moment the ball reaches
  // the zone (a pitch out of the zone halves them).
  bands: { barrel: number; solid: number; weak: number; foul: number };
  power: { strength: number; pw: number };
  // An at-bat in progress: its count, and a pitch thrown but not yet
  // swung at.
  open: { ab: number; pitchNo: number; balls: number; strikes: number; pending: BaseballPitch | null } | null;
  abs: BaseballLiveAtBat[];
}

export interface BaseballThrown extends BaseballPitch {
  ab: number;
  pitchNo: number;
  balls: number;
  strikes: number;
}

export interface BaseballSwing {
  call: BaseballCall;
  contact: BaseballContact | null;
  balls: number;
  strikes: number;
  // The at-bat's over (a walk, a strikeout or the ball in play).
  done: boolean;
  result: { kind: BaseballLiveResult; aim: BaseballZone | null; fielderPos: BaseballPos | null; contact: BaseballContact | null; late: boolean } | null;
  message: string;
  ready: number;
  waiting: number;
  // 0231: where it crossed, how far your tap was from it, and the timing.
  px: number;
  py: number;
  miss: number | null;
  timing: number | null;
}

export interface BaseballStealJump {
  jumpMs: number;
  slide: 'perfect' | 'early' | 'late' | 'none';
  grade: 'picked' | 'great' | 'good' | 'late';
  used: boolean;
  safe: boolean | null;
}

const num = (v: unknown) => Number(v ?? 0);

function toPitch(d: any): BaseballPitch {
  const kind: BaseballPitchKind = d?.kind === 'changeup' || d?.kind === 'curveball' ? d.kind : 'fastball';
  const inZone = !!d?.in_zone;
  // An older server has no spot: the middle, or just off the plate.
  const px = d?.px == null ? (inZone ? 0 : 1.3) : num(d.px);
  const py = d?.py == null ? 0 : num(d.py);
  return { kind, mph: num(d?.mph), inZone, ms: num(d?.ms) || 700, px, py };
}

function toStealJump(j: any): BaseballStealJump | null {
  if (!j) return null;
  return { jumpMs: num(j.jump_ms), slide: j.slide ?? 'none', grade: j.grade ?? 'late', used: !!j.used, safe: j.safe == null ? null : !!j.safe };
}

export function toBaseballLive(d: any): BaseballLive {
  const b = d?.bands ?? {};
  return {
    handsOn: d?.hands_on !== false,
    canBat: !!d?.can_bat,
    reason: d?.reason ?? null,
    day: d?.day ?? null,
    inning: num(d?.inning),
    team: d?.team ?? null,
    steps: num(d?.steps),
    abSteps: num(d?.ab_steps) || 3000,
    earned: num(d?.earned),
    taken: num(d?.taken),
    waiting: num(d?.waiting),
    ready: num(d?.ready),
    nextAt: d?.next_at == null ? null : num(d.next_at),
    cap: num(d?.cap) || 3,
    pitchedWaiting: num(d?.pitched_waiting),
    stealJump: toStealJump(d?.steal_jump),
    pitcher: d?.pitcher ? { name: d.pitcher.name ?? 'The pitcher', steps: num(d.pitcher.steps) } : null,
    pressure: num(d?.pressure),
    bands: { barrel: num(b.barrel) || 45, solid: num(b.solid) || 85, weak: num(b.weak) || 135, foul: num(b.foul) || 210 },
    power: { strength: num(d?.power?.strength), pw: num(d?.power?.pw) || 1 },
    open: d?.open
      ? {
          ab: num(d.open.ab),
          pitchNo: num(d.open.pitch_no),
          balls: num(d.open.balls),
          strikes: num(d.open.strikes),
          pending: d.open.pending ? toPitch(d.open.pending) : null,
        }
      : null,
    abs: ((d?.abs ?? []) as any[]).map((x) => ({
      n: num(x.n),
      day: x.day ?? '',
      result: x.result,
      contact: x.contact ?? null,
      aim: x.aim ?? null,
      fielderPos: x.fielder_pos ?? null,
      pitches: num(x.pitches),
      used: !!x.used,
      inning: x.inning == null ? null : num(x.inning),
    })),
  };
}

async function rpc<T = any>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireClient().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export async function getBaseballLive(challengeId: string): Promise<BaseballLive> {
  return toBaseballLive(await rpc<any>('baseball_live', { p_challenge_id: challengeId }));
}

// Opens an at-bat if none is open and throws the next pitch; called again
// before a swing, it returns the same pitch.
export async function throwBaseballPitch(challengeId: string): Promise<BaseballThrown> {
  const d = await rpc<any>('baseball_pitch', { p_challenge_id: challengeId });
  return { ...toPitch(d), ab: num(d?.ab), pitchNo: num(d?.pitch_no), balls: num(d?.balls), strikes: num(d?.strikes) };
}

// The swing: when you swung, in ms, against when the ball reached the
// zone (− early, + late), and where you tapped (0231, zone half-widths);
// null timing when you took the pitch.
export async function swingBaseball(challengeId: string, timingMs: number | null, tap?: { x: number; y: number } | null): Promise<BaseballSwing> {
  const t = timingMs == null ? null : Math.round(Math.max(-1000, Math.min(1000, timingMs)));
  const d = await rpc<any>(
    'baseball_swing',
    t != null && tap
      ? { p_challenge_id: challengeId, p_timing_ms: t, p_tap_x: Math.round(tap.x * 1000) / 1000, p_tap_y: Math.round(tap.y * 1000) / 1000 }
      : { p_challenge_id: challengeId, p_timing_ms: t },
  );
  const r = d?.result;
  return {
    call: d?.call ?? 'strike',
    contact: d?.contact ?? null,
    balls: num(d?.balls),
    strikes: num(d?.strikes),
    done: !!d?.done,
    result: r ? { kind: r.kind, aim: r.aim ?? null, fielderPos: r.fielder_pos ?? null, contact: r.contact ?? null, late: !!r.late } : null,
    message: d?.message ?? '',
    ready: num(d?.ready),
    waiting: num(d?.waiting),
    px: num(d?.px),
    py: num(d?.py),
    miss: d?.miss == null ? null : num(d.miss),
    timing: d?.timing == null ? null : num(d.timing),
  };
}

// ── On the mound (0231) ──

export interface BaseballMound {
  canPitch: boolean;
  reason: string | null;
  steps: number;
  earned: number;
  taken: number;
  ready: number;
  nextAt: number | null;
  cap: number;
  // Pitched at-bats waiting for their batters (at most 3).
  waiting: number;
  // Who's up: the other side's next batter, with their steps today.
  batter: { name: string; steps: number } | null;
  open: { ab: number; pitchNo: number; balls: number; strikes: number; lastKind: BaseballPitchKind | null } | null;
  abs: { n: number; result: BaseballLiveResult; batter: string; pitches: number; used: boolean; inning: number | null }[];
}

export interface BaseballThrowResult {
  call: BaseballCall;
  kind: BaseballPitchKind;
  mph: number;
  px: number;
  py: number;
  inZone: boolean;
  swung: boolean;
  contact: BaseballContact | null;
  grade: string;
  where: string;
  balls: number;
  strikes: number;
  done: boolean;
  batter: string;
  result: BaseballSwing['result'];
  message: string;
}

export function toBaseballMound(d: any): BaseballMound {
  return {
    canPitch: !!d?.can_pitch,
    reason: d?.reason ?? null,
    steps: num(d?.steps),
    earned: num(d?.earned),
    taken: num(d?.taken),
    ready: num(d?.ready),
    nextAt: d?.next_at == null ? null : num(d.next_at),
    cap: num(d?.cap) || 6,
    waiting: num(d?.waiting),
    batter: d?.batter ? { name: d.batter.name ?? 'The batter', steps: num(d.batter.steps) } : null,
    open: d?.open
      ? { ab: num(d.open.ab), pitchNo: num(d.open.pitch_no), balls: num(d.open.balls), strikes: num(d.open.strikes), lastKind: d.open.last_kind ?? null }
      : null,
    abs: ((d?.abs ?? []) as any[]).map((x) => ({
      n: num(x.n),
      result: x.result,
      batter: x.batter ?? 'The batter',
      pitches: num(x.pitches),
      used: !!x.used,
      inning: x.inning == null ? null : num(x.inning),
    })),
  };
}

export async function getBaseballMound(challengeId: string): Promise<BaseballMound> {
  return toBaseballMound(await rpc<any>('baseball_mound', { p_challenge_id: challengeId }));
}

// A pitch you throw: the kind, where you aimed (zone half-widths), and
// how far the closing ring was from the circle when you let it go (0 on
// it, 1 nowhere near). The batter answers it at once.
export async function throwBaseballMound(
  challengeId: string,
  kind: BaseballPitchKind,
  aim: { x: number; y: number },
  ring: number,
): Promise<BaseballThrowResult> {
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const d = await rpc<any>('baseball_throw', {
    p_challenge_id: challengeId,
    p_kind: kind,
    p_aim_x: r3(aim.x),
    p_aim_y: r3(aim.y),
    p_ring: r3(Math.max(0, Math.min(1, ring))),
  });
  const r = d?.result;
  return {
    call: d?.call ?? 'ball',
    kind: d?.kind ?? kind,
    mph: num(d?.mph),
    px: num(d?.px),
    py: num(d?.py),
    inZone: !!d?.in_zone,
    swung: !!d?.swung,
    contact: d?.contact ?? null,
    grade: d?.grade ?? '',
    where: d?.where ?? '',
    balls: num(d?.balls),
    strikes: num(d?.strikes),
    done: !!d?.done,
    batter: d?.batter ?? 'The batter',
    result: r ? { kind: r.kind, aim: r.aim ?? null, fielderPos: r.fielder_pos ?? null, contact: r.contact ?? null, late: !!r.late } : null,
    message: d?.message ?? '',
  };
}

// Your jump on a steal, once a day (0231): ms after the leg kick
// (negative: before it), and the slide.
export async function setBaseballStealJump(
  challengeId: string,
  jumpMs: number,
  slide: BaseballStealJump['slide'],
): Promise<{ grade: BaseballStealJump['grade']; message: string; jumpMs: number; slide: BaseballStealJump['slide'] }> {
  const d = await rpc<any>('baseball_steal_jump', { p_challenge_id: challengeId, p_jump_ms: Math.round(jumpMs), p_slide: slide });
  return { grade: d?.grade ?? 'late', message: d?.message ?? '', jumpMs: num(d?.jump_ms), slide: d?.slide ?? slide };
}
