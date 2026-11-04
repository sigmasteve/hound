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
export async function setupBaseball(challengeId: string, seats: BaseballSeat[]): Promise<void> {
  const { error } = await requireClient().rpc('baseball_setup', { p_challenge_id: challengeId, p_players: seats });
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
  };
}
