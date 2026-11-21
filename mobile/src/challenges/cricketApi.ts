import { supabase } from '../lib/supabase';
import type { CricketOutcome } from './cricket';

// The client-facing half of Cricket — see 0147_cricket.sql for the schema
// and RPCs this wraps. Same shape as soccerApi.ts.

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export type CricketTeam = 'a' | 'b';

// A seat holds a person or one of the challenge's bots; playerId is
// whichever it is. Seat is the batting order within the side.
export interface CricketPlayer {
  playerId: string;
  userId: string | null;
  botId: string | null;
  team: CricketTeam;
  seat: number;
  joined: boolean;
}

export interface CricketGame {
  challengeId: string;
  overs: number;
  battingFirst: CricketTeam;
  innings: 1 | 2;
  runsA: number;
  wicketsA: number;
  ballsA: number;
  runsB: number;
  wicketsB: number;
  ballsB: number;
  target: number | null;
  status: 'active' | 'final';
  winnerTeam: CricketTeam | null;
  result: 'chased' | 'defended' | 'tie' | null;
  players: CricketPlayer[];
}

export interface CricketBall {
  day: string;
  dayNo: number;
  innings: 1 | 2;
  overNo: number;
  ballNo: number;
  battingTeam: CricketTeam;
  batterId: string;
  bowlerId: string;
  batterSteps: number;
  bowlerSteps: number;
  outcome: CricketOutcome;
  runs: number;
}

// Who is on for the next over to be played.
export interface CricketOnStrike {
  innings: 1 | 2;
  overNo: number;
  battingTeam: CricketTeam;
  batterId: string;
  bowlerId: string;
}

export function otherSide(team: CricketTeam): CricketTeam {
  return team === 'a' ? 'b' : 'a';
}

export function cricketTeamOf(game: CricketGame, playerId: string | null | undefined): CricketTeam | null {
  return game.players.find((p) => p.playerId === playerId)?.team ?? null;
}

export function cricketSide(game: CricketGame, team: CricketTeam): CricketPlayer[] {
  return game.players.filter((p) => p.team === team).sort((a, b) => a.seat - b.seat);
}

export function battingNow(game: CricketGame): CricketTeam {
  return game.innings === 1 ? game.battingFirst : otherSide(game.battingFirst);
}

// Null when the match was never set up (cricket_setup failed after the
// challenge itself was created).
export async function getCricketGame(challengeId: string): Promise<CricketGame | null> {
  const client = requireClient();
  const [{ data, error }, { data: playerRows, error: playersError }] = await Promise.all([
    client.from('cricket_games').select('*').eq('challenge_id', challengeId).maybeSingle(),
    client.from('cricket_players').select('user_id, bot_id, team, seat, joined').eq('challenge_id', challengeId),
  ]);
  if (error) throw new Error(error.message);
  if (playersError) throw new Error(playersError.message);
  if (!data) return null;
  return {
    challengeId: data.challenge_id,
    overs: data.overs,
    battingFirst: data.batting_first as CricketTeam,
    innings: data.innings as 1 | 2,
    runsA: data.runs_a,
    wicketsA: data.wickets_a,
    ballsA: data.balls_a,
    runsB: data.runs_b,
    wicketsB: data.wickets_b,
    ballsB: data.balls_b,
    target: data.target ?? null,
    status: data.status as 'active' | 'final',
    winnerTeam: (data.winner_team as CricketTeam | null) ?? null,
    result: (data.result as CricketGame['result']) ?? null,
    players: (playerRows ?? []).map((r) => ({
      playerId: (r.user_id ?? r.bot_id) as string,
      userId: r.user_id ?? null,
      botId: r.bot_id ?? null,
      team: r.team as CricketTeam,
      seat: r.seat,
      joined: !!r.joined,
    })),
  };
}

export async function listCricketBalls(challengeId: string): Promise<CricketBall[]> {
  const { data, error } = await requireClient()
    .from('cricket_balls')
    .select('day, day_no, innings, over_no, ball_no, batting_team, batter_id, bowler_id, batter_steps, bowler_steps, outcome, runs')
    .eq('challenge_id', challengeId)
    .order('innings', { ascending: true })
    .order('over_no', { ascending: true })
    .order('ball_no', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    day: r.day,
    dayNo: r.day_no,
    innings: r.innings as 1 | 2,
    overNo: r.over_no,
    ballNo: r.ball_no,
    battingTeam: r.batting_team as CricketTeam,
    batterId: r.batter_id,
    bowlerId: r.bowler_id,
    batterSteps: r.batter_steps,
    bowlerSteps: r.bowler_steps,
    outcome: r.outcome as CricketOutcome,
    runs: r.runs,
  }));
}

export async function getCricketOnStrike(challengeId: string): Promise<CricketOnStrike | null> {
  const { data, error } = await requireClient().rpc('cricket_on_strike', { p_challenge_id: challengeId });
  if (error) throw new Error(error.message);
  const row = (data as { innings: number; over_no: number; batting_team: string; batter_id: string; bowler_id: string }[] | null)?.[0];
  if (!row || !row.batter_id || !row.bowler_id) return null;
  return {
    innings: row.innings as 1 | 2,
    overNo: row.over_no,
    battingTeam: row.batting_team as CricketTeam,
    batterId: row.batter_id,
    bowlerId: row.bowler_id,
  };
}

export interface CricketSeat {
  id: string;
  team: CricketTeam;
}

// The creator stores both sides right after creating the challenge, in
// batting order. Each id is the creator, a friend (who still has to
// accept the invite) or one of this challenge's bots.
export async function setupCricket(challengeId: string, seats: CricketSeat[]): Promise<void> {
  const { error } = await requireClient().rpc('cricket_setup', { p_challenge_id: challengeId, p_players: seats });
  if (error) throw new Error(error.message);
}

// Seats a friend after the match is made, at the end of that side's order.
export async function addCricketPlayer(challengeId: string, userId: string, team: CricketTeam): Promise<void> {
  const { error } = await requireClient().rpc('cricket_add_player', { p_challenge_id: challengeId, p_user_id: userId, p_team: team });
  if (error) throw new Error(error.message);
}

// Plays every over that's due and ends the match after the chase. Safe to
// call any time — a no-op otherwise.
export async function advanceCricket(challengeId: string): Promise<number> {
  const { data, error } = await requireClient().rpc('cricket_advance', { p_challenge_id: challengeId });
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}

// ── Bat and bowl yourself (0234) ──

export type CricketBallKind = 'pace' | 'spin' | 'yorker';
export type CricketLength = 'yorker' | 'full' | 'good' | 'short';

export interface CricketDelivery {
  n: number;
  kind: CricketBallKind;
  length: CricketLength;
  // Across: |line| <= 0.28 hits the stumps, − the off side. Along: where
  // it pitches, 0 at the batter's stumps to 1 at the bowler's.
  line: number;
  bounce: number;
  turn: number;
  mph: number;
  ms: number;
}

export interface CricketHandBall {
  n: number;
  outcome: CricketOutcome;
  how: string;
  kind: CricketBallKind;
  used: boolean;
}

export interface CricketHand {
  handsOn: boolean;
  role: 'bat' | 'bowl' | null;
  canPlay: boolean;
  reason: string | null;
  steps: number;
  earned: number;
  taken: number;
  ready: number;
  nextAt: number | null;
  innings: number | null;
  overNo: number | null;
  overs: number;
  battingTeam: CricketTeam | null;
  myTeam: CricketTeam | null;
  score: { runs: number; wickets: number; target: number | null };
  opponent: { name: string; steps: number } | null;
  pending: CricketDelivery | null;
  balls: CricketHandBall[];
}

const num = (v: unknown) => Number(v ?? 0);

function toDelivery(d: any): CricketDelivery {
  return {
    n: num(d?.n),
    kind: (d?.kind ?? 'pace') as CricketBallKind,
    length: (d?.length ?? 'good') as CricketLength,
    line: num(d?.line),
    bounce: num(d?.bounce) || 0.3,
    turn: num(d?.turn),
    mph: num(d?.mph),
    ms: num(d?.ms) || 700,
  };
}

function toHandBalls(x: any): CricketHandBall[] {
  return ((x ?? []) as any[]).map((b) => ({ n: num(b.n), outcome: b.outcome as CricketOutcome, how: b.how ?? '', kind: b.kind, used: !!b.used }));
}

export function toCricketHand(d: any): CricketHand {
  return {
    handsOn: !!d?.hands_on,
    role: d?.role ?? null,
    canPlay: !!d?.can_play,
    reason: d?.reason ?? null,
    steps: num(d?.steps),
    earned: num(d?.earned),
    taken: num(d?.taken),
    ready: num(d?.ready),
    nextAt: d?.next_at == null ? null : num(d.next_at),
    innings: d?.innings == null ? null : num(d.innings),
    overNo: d?.over_no == null ? null : num(d.over_no),
    overs: num(d?.overs),
    battingTeam: d?.batting_team ?? null,
    myTeam: d?.my_team ?? null,
    score: { runs: num(d?.score?.runs), wickets: num(d?.score?.wickets), target: d?.score?.target == null ? null : num(d.score.target) },
    opponent: d?.opponent ? { name: d.opponent.name ?? 'Someone', steps: num(d.opponent.steps) } : null,
    pending: d?.pending ? toDelivery(d.pending) : null,
    balls: toHandBalls(d?.balls),
  };
}

async function rpc<T = any>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireClient().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export async function getCricketHand(challengeId: string): Promise<CricketHand> {
  return toCricketHand(await rpc('cricket_hand', { p_challenge_id: challengeId }));
}

// Batting: the next ball bowled to you (the same one again until you play it).
export async function bowlToMe(challengeId: string): Promise<CricketDelivery> {
  return toDelivery(await rpc('cricket_bowl_to_me', { p_challenge_id: challengeId }));
}

export interface CricketShot {
  outcome: CricketOutcome;
  how: string;
  runs: number;
  message: string;
  timing: number | null;
  miss: number | null;
  ready: number;
  taken: number;
  balls: CricketHandBall[];
}

// timing: ms against the ball reaching the bat (− early), null to leave
// it; miss: how far the tap was from the ball (1 = the edge of the bat).
export async function playCricketShot(challengeId: string, timing: number | null, miss: number | null): Promise<CricketShot> {
  const d = await rpc<any>('cricket_play_shot', {
    p_challenge_id: challengeId,
    p_timing_ms: timing == null ? null : Math.round(timing),
    p_miss: miss == null ? null : Math.round(miss * 1000) / 1000,
  });
  return {
    outcome: d?.outcome ?? '0',
    how: d?.how ?? '',
    runs: num(d?.runs),
    message: d?.message ?? '',
    timing: d?.timing == null ? null : num(d.timing),
    miss: d?.miss == null ? null : num(d.miss),
    ready: num(d?.ready),
    taken: num(d?.taken),
    balls: toHandBalls(d?.balls),
  };
}

export interface CricketBowled {
  outcome: CricketOutcome;
  how: string;
  length: CricketLength;
  line: number;
  bounce: number;
  turn: number;
  grade: string;
  message: string;
  batter: string;
  ready: number;
  taken: number;
  balls: CricketHandBall[];
}

// Bowling: the ball, where you aimed on the pitch (line across, length
// along), and how far the ring was from the circle (0 on it, 1 nowhere).
export async function bowlCricketBall(challengeId: string, kind: CricketBallKind, aim: { line: number; length: number }, ring: number): Promise<CricketBowled> {
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const d = await rpc<any>('cricket_bowl', {
    p_challenge_id: challengeId,
    p_kind: kind,
    p_aim_line: r3(aim.line),
    p_aim_length: r3(aim.length),
    p_ring: r3(Math.max(0, Math.min(1, ring))),
  });
  return {
    outcome: d?.outcome ?? '0',
    how: d?.how ?? '',
    length: d?.length ?? 'good',
    line: num(d?.line),
    bounce: num(d?.bounce),
    turn: num(d?.turn),
    grade: d?.grade ?? '',
    message: d?.message ?? '',
    batter: d?.batter ?? 'The batter',
    ready: num(d?.ready),
    taken: num(d?.taken),
    balls: toHandBalls(d?.balls),
  };
}

// The creator's switch, right after setup.
export async function setCricketHandsOn(challengeId: string, on: boolean): Promise<void> {
  await rpc('cricket_set_hands_on', { p_challenge_id: challengeId, p_on: on });
}

export interface CricketOverview {
  active: number;
  finished: number;
  handsOn: number;
  chased: number;
  defended: number;
  ties: number;
  batters7d: number;
  bowlers7d: number;
  batBalls7d: number;
  bowlBalls7d: number;
  sixes7d: number;
  fours7d: number;
  outsBatting7d: number;
  wicketsBowling7d: number;
  used7d: number;
  runsPerBallHand: number | null;
  runsPerBallRolled: number | null;
}

export async function getCricketOverview(): Promise<CricketOverview> {
  const d = (await rpc<any>('admin_cricket_overview', {})) ?? {};
  const opt = (v: unknown) => (v == null ? null : Number(v));
  return {
    active: num(d.active),
    finished: num(d.finished),
    handsOn: num(d.hands_on),
    chased: num(d.chased),
    defended: num(d.defended),
    ties: num(d.ties),
    batters7d: num(d.batters_7d),
    bowlers7d: num(d.bowlers_7d),
    batBalls7d: num(d.bat_balls_7d),
    bowlBalls7d: num(d.bowl_balls_7d),
    sixes7d: num(d.sixes_7d),
    fours7d: num(d.fours_7d),
    outsBatting7d: num(d.outs_batting_7d),
    wicketsBowling7d: num(d.wickets_bowling_7d),
    used7d: num(d.used_7d),
    runsPerBallHand: opt(d.runs_per_ball_hand),
    runsPerBallRolled: opt(d.runs_per_ball_rolled),
  };
}

export function cricketSummary(o: CricketOverview): string {
  return `${o.active} ${o.active === 1 ? 'match' : 'matches'} on${o.batBalls7d + o.bowlBalls7d > 0 ? ` · ${o.batBalls7d + o.bowlBalls7d} balls by hand this week` : ''}`;
}
