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
