import { supabase } from '../lib/supabase';
import { DEFAULT_SOCCER_SHOT_STEPS, type SoccerPosition } from './soccer';

// The client-facing half of Soccer — see 0142_soccer.sql for the schema
// and RPCs this wraps. Same shape as rallyApi.ts.

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export type SoccerTeam = 'a' | 'b';
export type SoccerStatus = 'active' | 'final';

// A seat holds a person or one of the challenge's bots; playerId is
// whichever it is. `joined` flips when a person accepts the invite.
export interface SoccerPlayer {
  playerId: string;
  userId: string | null;
  botId: string | null;
  team: SoccerTeam;
  position: SoccerPosition;
  joined: boolean;
}

export interface SoccerGame {
  challengeId: string;
  shotSteps: number;
  goalsA: number;
  goalsB: number;
  daysPlayed: number;
  status: SoccerStatus;
  winnerTeam: SoccerTeam | null;
  players: SoccerPlayer[];
}

export interface SoccerDay {
  day: string;
  dayNo: number;
  goalsA: number;
  goalsB: number;
  shotsA: number;
  shotsB: number;
  onTargetA: number;
  onTargetB: number;
  savesA: number;
  savesB: number;
}

export interface SoccerShot {
  day: string;
  dayNo: number;
  team: SoccerTeam;
  shooterId: string;
  keeperId: string | null;
  shooterSteps: number;
  shotNo: number;
  outcome: 'miss' | 'saved' | 'goal';
}

export function soccerTeamOf(game: SoccerGame, playerId: string | null | undefined): SoccerTeam | null {
  return game.players.find((p) => p.playerId === playerId)?.team ?? null;
}

export function soccerTeamMembers(game: SoccerGame, team: SoccerTeam): SoccerPlayer[] {
  const order: Record<SoccerPosition, number> = { keeper: 0, defender: 1, forward: 2 };
  return game.players.filter((p) => p.team === team).sort((a, b) => order[a.position] - order[b.position] || a.playerId.localeCompare(b.playerId));
}

// Null when the match was never set up (soccer_setup failed after the
// challenge itself was created).
export async function getSoccerGame(challengeId: string): Promise<SoccerGame | null> {
  const client = requireClient();
  const [{ data, error }, { data: playerRows, error: playersError }] = await Promise.all([
    client.from('soccer_games').select('*').eq('challenge_id', challengeId).maybeSingle(),
    client.from('soccer_players').select('user_id, bot_id, team, position, joined').eq('challenge_id', challengeId),
  ]);
  if (error) throw new Error(error.message);
  if (playersError) throw new Error(playersError.message);
  if (!data) return null;
  return {
    challengeId: data.challenge_id,
    shotSteps: data.shot_steps ?? DEFAULT_SOCCER_SHOT_STEPS,
    goalsA: data.goals_a,
    goalsB: data.goals_b,
    daysPlayed: data.days_played,
    status: data.status as SoccerStatus,
    winnerTeam: (data.winner_team as SoccerTeam | null) ?? null,
    players: (playerRows ?? []).map((r) => ({
      playerId: (r.user_id ?? r.bot_id) as string,
      userId: r.user_id ?? null,
      botId: r.bot_id ?? null,
      team: r.team as SoccerTeam,
      position: r.position as SoccerPosition,
      joined: !!r.joined,
    })),
  };
}

export async function listSoccerDays(challengeId: string): Promise<SoccerDay[]> {
  const { data, error } = await requireClient().from('soccer_days').select('*').eq('challenge_id', challengeId).order('day_no', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    day: r.day,
    dayNo: r.day_no,
    goalsA: r.goals_a,
    goalsB: r.goals_b,
    shotsA: r.shots_a,
    shotsB: r.shots_b,
    onTargetA: r.on_target_a,
    onTargetB: r.on_target_b,
    savesA: r.saves_a,
    savesB: r.saves_b,
  }));
}

export async function listSoccerShots(challengeId: string): Promise<SoccerShot[]> {
  const { data, error } = await requireClient()
    .from('soccer_events')
    .select('day, day_no, team, shooter_id, keeper_id, shooter_steps, shot_no, outcome')
    .eq('challenge_id', challengeId)
    .order('day_no', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    day: r.day,
    dayNo: r.day_no,
    team: r.team as SoccerTeam,
    shooterId: r.shooter_id,
    keeperId: r.keeper_id,
    shooterSteps: r.shooter_steps,
    shotNo: r.shot_no,
    outcome: r.outcome as SoccerShot['outcome'],
  }));
}

export interface SoccerSeat {
  id: string;
  team: SoccerTeam;
  position: SoccerPosition;
}

// The creator stores the shot size and both line-ups right after creating
// the challenge. Each id is the creator, a friend (who still has to
// accept the invite) or one of this challenge's bots.
export async function setupSoccer(challengeId: string, shotSteps: number, seats: SoccerSeat[]): Promise<void> {
  const { error } = await requireClient().rpc('soccer_setup', {
    p_challenge_id: challengeId,
    p_shot_steps: shotSteps,
    p_players: seats,
  });
  if (error) throw new Error(error.message);
}

// Seats a friend after the match is made (0143): the creator picks their
// team and position, then the invite goes out as usual. Same rules as
// setup: nine a side, one keeper a team.
export async function addSoccerPlayer(challengeId: string, userId: string, team: SoccerTeam, position: SoccerPosition): Promise<void> {
  const { error } = await requireClient().rpc('soccer_add_player', {
    p_challenge_id: challengeId,
    p_user_id: userId,
    p_team: team,
    p_position: position,
  });
  if (error) throw new Error(error.message);
}

// Clears a seat nobody took up, and the invite with it.
export async function removeSoccerPlayer(challengeId: string, userId: string): Promise<void> {
  const { error } = await requireClient().rpc('soccer_remove_player', { p_challenge_id: challengeId, p_user_id: userId });
  if (error) throw new Error(error.message);
}

// Plays every day that's over everywhere and not yet played, and ends the
// match after its last day. Safe to call any time — a no-op otherwise.
export async function advanceSoccer(challengeId: string): Promise<number> {
  const { data, error } = await requireClient().rpc('soccer_advance', { p_challenge_id: challengeId });
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}
