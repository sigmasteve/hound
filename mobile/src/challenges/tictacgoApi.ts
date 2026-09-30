import { supabase } from '../lib/supabase';
import { DEFAULT_TICTACGO_WINDOW_HOURS, toZeroBasedLine, type TicTacGoDifficulty } from './tictacgo';

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export type TicTacGoStatus = 'waiting' | 'active' | 'won' | 'draw';
export type TicTacGoEndedReason = 'three_in_a_row' | 'board_full' | 'time_up';

export interface TicTacGoGame {
  challengeId: string;
  difficulty: TicTacGoDifficulty;
  // Goal ids, one per square (0-8, row by row) — see tictacgo.ts.
  goals: string[];
  // Who claimed each square; null = open.
  marks: (string | null)[];
  xUserId: string | null;
  oUserId: string | null;
  turnUserId: string | null;
  turnStartedAt: string | null;
  // How many hours before a turn began activity still counts (0079) —
  // 24 for every game made before the setting existed.
  activityWindowHours: number;
  // When each player last claimed a steps square, and the workouts each
  // has already claimed a square with (0079) — what the next claim has
  // to leave out.
  xStepsClaimedAt: string | null;
  oStepsClaimedAt: string | null;
  xUsedWorkouts: string[];
  oUsedWorkouts: string[];
  // Whether 0079 has run (the columns above exist) — decides which claim
  // function to call.
  hasClaimTracking: boolean;
  status: TicTacGoStatus;
  winnerUserId: string | null;
  // 0-based square indexes.
  winningLine: number[] | null;
  endedReason: TicTacGoEndedReason | null;
}

// Null when the board was never set up (tictacgo_setup failed after the
// challenge itself was created).
export async function getTicTacGoGame(challengeId: string): Promise<TicTacGoGame | null> {
  const { data, error } = await requireClient()
    .from('tictacgo_games')
    // '*' rather than a column list so this keeps working before
    // 0079_tictacgo_window_setting.sql adds its columns.
    .select('*')
    .eq('challenge_id', challengeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    challengeId: data.challenge_id,
    difficulty: data.difficulty as TicTacGoDifficulty,
    goals: data.goals as string[],
    marks: data.marks as (string | null)[],
    xUserId: data.x_user_id,
    oUserId: data.o_user_id,
    turnUserId: data.turn_user_id,
    turnStartedAt: data.turn_started_at,
    activityWindowHours: data.activity_window_hours ?? DEFAULT_TICTACGO_WINDOW_HOURS,
    xStepsClaimedAt: data.x_steps_claimed_at ?? null,
    oStepsClaimedAt: data.o_steps_claimed_at ?? null,
    xUsedWorkouts: (data.x_used_workouts as string[] | undefined) ?? [],
    oUsedWorkouts: (data.o_used_workouts as string[] | undefined) ?? [],
    hasClaimTracking: data.activity_window_hours !== undefined,
    status: data.status as TicTacGoStatus,
    winnerUserId: data.winner_user_id,
    winningLine: toZeroBasedLine(data.winning_line as number[] | null),
    endedReason: data.ended_reason as TicTacGoEndedReason | null,
  };
}

export async function setupTicTacGoBoard(
  challengeId: string,
  difficulty: TicTacGoDifficulty,
  goals: string[],
  windowHours: number = DEFAULT_TICTACGO_WINDOW_HOURS,
): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc('tictacgo_setup', {
    p_challenge_id: challengeId,
    p_difficulty: difficulty,
    p_goals: goals,
  });
  if (error) throw new Error(error.message);
  // 24 is every game's default, so there's nothing to set.
  if (windowHours !== DEFAULT_TICTACGO_WINDOW_HOURS) {
    const { error: windowError } = await client.rpc('tictacgo_set_window', {
      p_challenge_id: challengeId,
      p_hours: windowHours,
    });
    if (windowError) throw new Error(windowError.message);
  }
}

// Passes a turn that's run past 24 hours, or ends the game as a draw once
// the challenge's own end date arrives. Safe to call any time — a no-op
// otherwise.
export async function settleTicTacGo(challengeId: string): Promise<void> {
  const { error } = await requireClient().rpc('tictacgo_settle', { p_challenge_id: challengeId });
  if (error) throw new Error(error.message);
}

// Settles first, as its own call: the claim function refuses a late move
// without changing anything, so the turn-pass has to be persisted
// separately (see 0057's comment on tictacgo_claim_square).
export async function claimTicTacGoSquare(
  game: Pick<TicTacGoGame, 'challengeId' | 'hasClaimTracking'>,
  square: number,
  workoutId: string | null,
): Promise<TicTacGoStatus> {
  await settleTicTacGo(game.challengeId);
  // tictacgo_claim (0079) also records what the claim used; before 0079
  // runs, only 0057's plain claim exists.
  const { data, error } = game.hasClaimTracking
    ? await requireClient().rpc('tictacgo_claim', {
        p_challenge_id: game.challengeId,
        p_square: square,
        p_workout_id: workoutId,
      })
    : await requireClient().rpc('tictacgo_claim_square', {
        p_challenge_id: game.challengeId,
        p_square: square,
      });
  if (error) throw new Error(error.message);
  return data as TicTacGoStatus;
}
