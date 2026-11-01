import { supabase } from '../lib/supabase';
import { DEFAULT_RALLY_SERVE_STEPS, DEFAULT_RALLY_WINDOW_HOURS } from './rally';

// The client-facing half of Rally — see 0139_rally.sql for the schema and
// RPCs this wraps. Same shape as tictacgoApi.ts.

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export type RallyStatus = 'waiting' | 'active' | 'won' | 'draw';
export type RallyEndedReason = 'two_games' | 'time_up';
export type RallyTeam = 'a' | 'b';

// Who plays where. Team A is the creator's; seat 2 is the doubles
// partner. `joined` flips when the person accepts the invite.
export interface RallyPlayer {
  userId: string;
  team: RallyTeam;
  seat: 1 | 2;
  joined: boolean;
}

export interface RallyGame {
  challengeId: string;
  serveSteps: number;
  windowHours: number;
  doubles: boolean;
  players: RallyPlayer[];
  status: RallyStatus;
  gameNo: number;
  gamesA: number;
  gamesB: number;
  pointsA: number;
  pointsB: number;
  // Whose side the shuttle is on, who has to return it, what the return
  // needs, their total when it arrived, when, and when it's due. All
  // null once the match is over.
  sideTeam: RallyTeam | null;
  sideUserId: string | null;
  targetSteps: number | null;
  sideStartTotal: number | null;
  sideSince: string | null;
  dueAt: string | null;
  shotNo: number;
  smashALeft: number;
  smashBLeft: number;
  smashArmed: boolean;
  winnerTeam: RallyTeam | null;
  endedReason: RallyEndedReason | null;
}

export function rallyTeamOf(game: RallyGame, userId: string | null | undefined): RallyTeam | null {
  return game.players.find((p) => p.userId === userId)?.team ?? null;
}

export function rallyTeamMembers(game: RallyGame, team: RallyTeam): RallyPlayer[] {
  return game.players.filter((p) => p.team === team).sort((a, b) => a.seat - b.seat);
}

// Null when the game was never set up (rally_setup failed after the
// challenge itself was created).
export async function getRallyGame(challengeId: string): Promise<RallyGame | null> {
  const client = requireClient();
  const [{ data, error }, { data: playerRows, error: playersError }] = await Promise.all([
    client.from('rally_games').select('*').eq('challenge_id', challengeId).maybeSingle(),
    client.from('rally_players').select('user_id, team, seat, joined').eq('challenge_id', challengeId),
  ]);
  if (error) throw new Error(error.message);
  if (playersError) throw new Error(playersError.message);
  if (!data) return null;
  return {
    challengeId: data.challenge_id,
    serveSteps: data.serve_steps ?? DEFAULT_RALLY_SERVE_STEPS,
    windowHours: data.window_hours ?? DEFAULT_RALLY_WINDOW_HOURS,
    doubles: !!data.doubles,
    players: (playerRows ?? []).map((r) => ({ userId: r.user_id, team: r.team as RallyTeam, seat: r.seat as 1 | 2, joined: !!r.joined })),
    status: data.status as RallyStatus,
    gameNo: data.game_no,
    gamesA: data.games_a,
    gamesB: data.games_b,
    pointsA: data.points_a,
    pointsB: data.points_b,
    sideTeam: (data.side_team as RallyTeam | null) ?? null,
    sideUserId: data.side_user_id,
    targetSteps: data.target_steps,
    sideStartTotal: data.side_start_total == null ? null : Number(data.side_start_total),
    sideSince: data.side_since,
    dueAt: data.due_at,
    shotNo: data.shot_no,
    smashALeft: data.smash_a_left,
    smashBLeft: data.smash_b_left,
    smashArmed: !!data.smash_armed,
    winnerTeam: (data.winner_team as RallyTeam | null) ?? null,
    endedReason: data.ended_reason as RallyEndedReason | null,
  };
}

// The creator stores the serve, the window and the teams right after
// creating the challenge: a partner (null for singles) and one or two
// opponents, who still have to accept their invites.
export async function setupRally(
  challengeId: string,
  serveSteps: number,
  windowHours: number,
  partnerId: string | null,
  opponentIds: string[],
): Promise<void> {
  const { error } = await requireClient().rpc('rally_setup', {
    p_challenge_id: challengeId,
    p_serve_steps: serveSteps,
    p_window_hours: windowHours,
    p_partner: partnerId,
    p_opponents: opponentIds,
  });
  if (error) throw new Error(error.message);
}

// Scores a missed return, or ends the match once the challenge's own end
// arrives. Safe to call any time — a no-op otherwise.
export async function settleRally(challengeId: string): Promise<void> {
  const { error } = await requireClient().rpc('rally_settle', { p_challenge_id: challengeId });
  if (error) throw new Error(error.message);
}

export type RallyShotResult = 'returned' | 'smashed' | 'short' | 'not_your_side' | 'not_started' | 'inactive';

// Whether the caller has returned the shuttle: the server re-reads their
// synced steps since it arrived. Settles first (a missed deadline scores
// before a late return can land). Call after every device sync while the
// shuttle is on the caller's side.
export async function checkRallyShot(challengeId: string): Promise<RallyShotResult> {
  const { data, error } = await requireClient().rpc('rally_check_shot', { p_challenge_id: challengeId });
  if (error) throw new Error(error.message);
  return data as RallyShotResult;
}

// Arms the team's smash for the return on the caller's side now: it
// needs double the target, and landing it doubles the other team's next.
// One per team per game, and it can't be taken back.
export async function armRallySmash(challengeId: string): Promise<void> {
  const { error } = await requireClient().rpc('rally_arm_smash', { p_challenge_id: challengeId });
  if (error) throw new Error(error.message);
}

export interface RallyEvent {
  kind: 'start' | 'return' | 'smash' | 'miss' | 'game' | 'match' | 'time_up';
  userId: string | null;
  team: RallyTeam | null;
  steps: number | null;
  target: number | null;
  gameNo: number;
  pointsA: number;
  pointsB: number;
  createdAt: string;
}

// Everything that happened, oldest first.
export async function listRallyEvents(challengeId: string): Promise<RallyEvent[]> {
  const { data, error } = await requireClient()
    .from('rally_events')
    .select('kind, user_id, team, steps, target, game_no, points_a, points_b, created_at')
    .eq('challenge_id', challengeId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    kind: row.kind as RallyEvent['kind'],
    userId: row.user_id,
    team: (row.team as RallyTeam | null) ?? null,
    steps: row.steps,
    target: row.target,
    gameNo: row.game_no,
    pointsA: row.points_a,
    pointsB: row.points_b,
    createdAt: row.created_at,
  }));
}

export interface MyRallyShot {
  challengeId: string;
  targetSteps: number;
  dueAt: string | null;
  smashArmed: boolean;
}

// Every Rally where the shuttle is on the caller's side right now, for
// Home's Needs you card.
export async function listMyRallyShots(): Promise<Map<string, MyRallyShot>> {
  const { data, error } = await requireClient().rpc('my_rally_shots');
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { challenge_id: string; target_steps: number; due_at: string | null; smash_armed: boolean }[];
  return new Map(rows.map((r) => [r.challenge_id, { challengeId: r.challenge_id, targetSteps: r.target_steps, dueAt: r.due_at, smashArmed: r.smash_armed }]));
}
