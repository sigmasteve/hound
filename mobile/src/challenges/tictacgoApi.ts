import { supabase } from '../lib/supabase';
import { toZeroBasedLine, type TicTacGoDifficulty } from './tictacgo';

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
  // When each player last claimed a square (0078) — null before their
  // first claim, and before 0078 has run.
  xLastClaimAt: string | null;
  oLastClaimAt: string | null;
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
    // 0078_tictacgo_activity_window.sql adds the last-claim columns.
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
    xLastClaimAt: data.x_last_claim_at ?? null,
    oLastClaimAt: data.o_last_claim_at ?? null,
    status: data.status as TicTacGoStatus,
    winnerUserId: data.winner_user_id,
    winningLine: toZeroBasedLine(data.winning_line as number[] | null),
    endedReason: data.ended_reason as TicTacGoEndedReason | null,
  };
}

export async function setupTicTacGoBoard(challengeId: string, difficulty: TicTacGoDifficulty, goals: string[]): Promise<void> {
  const { error } = await requireClient().rpc('tictacgo_setup', {
    p_challenge_id: challengeId,
    p_difficulty: difficulty,
    p_goals: goals,
  });
  if (error) throw new Error(error.message);
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
export async function claimTicTacGoSquare(challengeId: string, square: number): Promise<TicTacGoStatus> {
  await settleTicTacGo(challengeId);
  const { data, error } = await requireClient().rpc('tictacgo_claim_square', {
    p_challenge_id: challengeId,
    p_square: square,
  });
  if (error) throw new Error(error.message);
  return data as TicTacGoStatus;
}
