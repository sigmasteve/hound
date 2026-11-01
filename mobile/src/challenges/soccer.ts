// Pure rules and words for Soccer — no Supabase/RN imports, same as
// rally.ts. The server (0142_soccer.sql) plays every day; this file owns
// the numbers Create offers and how a match reads on a screen.

export type SoccerPosition = 'forward' | 'defender' | 'keeper';

export const SOCCER_POSITIONS: SoccerPosition[] = ['forward', 'defender', 'keeper'];

export const SOCCER_POSITION_NAME: Record<SoccerPosition, string> = {
  forward: 'Forward',
  defender: 'Defender',
  keeper: 'Keeper',
};

export const SOCCER_POSITION_SHORT: Record<SoccerPosition, string> = { forward: 'FW', defender: 'DF', keeper: 'GK' };

export const SOCCER_POSITION_DESC: Record<SoccerPosition, string> = {
  forward: 'Your steps take the shots: one per shot size walked in a day, up to four. Walk more and more of them go on target.',
  defender: 'Your steps make their shots miss: the more the defense walks, the fewer shots are on target.',
  keeper: 'Your steps make the saves: the more you walk, the more shots on target you stop. One a team.',
};

// How many steps make a shot.
export const SOCCER_SHOT_OPTIONS = [2000, 3000, 4000, 5000] as const;
export const DEFAULT_SOCCER_SHOT_STEPS = 3000;
export const SOCCER_MAX_SHOTS_A_DAY = 4;
export const SOCCER_MAX_TEAM = 9;
export const DEFAULT_SOCCER_DAYS = 9;

// Ninety minutes spread over the match's days: "40'" after day 4 of 9.
export function soccerClock(daysPlayed: number, days: number): string {
  if (days <= 0) return "0'";
  return `${Math.round((90 * Math.min(daysPlayed, days)) / days)}'`;
}

export function shotsFor(steps: number, shotSteps: number): number {
  return Math.min(SOCCER_MAX_SHOTS_A_DAY, Math.floor(steps / Math.max(1, shotSteps)));
}

export function formatSteps(n: number): string {
  return `${Math.round(n).toLocaleString()} steps`;
}
