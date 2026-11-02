// Pure rules and words for Cricket — no Supabase/RN imports, same as
// soccer.ts. The server (0147_cricket.sql) plays every over; this file
// owns how a match reads on a screen.

export type CricketOutcome = '0' | '1' | '2' | '4' | '6' | 'W';

export const DEFAULT_CRICKET_DAYS = 10;
export const CRICKET_MAX_SIDE = 9;

// A side is all out after max(3, its size) wickets, so a side of one or
// two gets three lives.
export function wicketsAllowed(sideSize: number): number {
  return Math.max(3, sideSize);
}

// Balls as overs, the way a scoreboard shows them: 27 balls is "4.3".
export function oversLabel(balls: number): string {
  return `${Math.floor(balls / 6)}.${balls % 6}`;
}

export function oversPerInnings(days: number): number {
  return Math.floor(days / 2);
}

export function formatSteps(n: number): string {
  return `${Math.round(n).toLocaleString()} steps`;
}

// What a ball reads as in an over: a dot for no run.
export function ballLabel(o: CricketOutcome): string {
  return o === '0' ? '•' : o;
}
