// Pure rules and words for Hoops and H-O-R-S-E — no Supabase/RN imports,
// same as soccer.ts. The server (0195_hoops.sql, 0196_horse.sql) plays
// every day; this file owns the numbers Create offers and how a game
// reads on a screen.

export type HoopsTeam = 'home' | 'away';
export type HoopsShot = 'drive' | 'mid' | 'three';
export type HoopsDefense = 'paint' | 'arc';
export type HoopsEventKind = 'drive' | 'mid' | 'three' | 'ft' | 'putback';

export const HOOPS_SHOT_OPTIONS = [1500, 2000, 2500, 3000] as const;
export const DEFAULT_HOOPS_SHOT_STEPS = 2000;
export const HOOPS_MAX_SHOTS_A_DAY = 5;
export const HOOPS_MAX_SIDE = 9;
export const HOOPS_QUARTERS = 4;
export const HOOPS_DAYS_PER_QUARTER = [1, 2] as const;
export const DEFAULT_HOOPS_TEAM_NAMES: Record<HoopsTeam, string> = { home: 'Hounds', away: 'Strays' };

export const HOOPS_SHOTS: HoopsShot[] = ['drive', 'mid', 'three'];

export const HOOPS_SHOT_NAME: Record<HoopsShot, string> = { drive: 'Drive', mid: 'Mid-range', three: 'Three' };
export const HOOPS_SHOT_POINTS: Record<HoopsShot, number> = { drive: 2, mid: 2, three: 3 };

export const HOOPS_DEFENSE_NAME: Record<HoopsDefense, string> = { paint: 'Pack the paint', arc: 'Guard the arc' };
export const HOOPS_DEFENSE_NOTE: Record<HoopsDefense, string> = {
  paint: 'Their drives get harder',
  arc: 'Their threes get harder',
};

// Team colours: the near-end ring under each hound and the scoreboard.
export const HOOPS_TEAM_COLOR: Record<HoopsTeam, string> = { home: '#f08a24', away: '#4f7ae5' };
export const HOOPS_TEAM_TEXT: Record<HoopsTeam, string> = { home: '#ffd8b0', away: '#c9d6ff' };

export function hoopsShotsFor(steps: number, shotSteps: number): number {
  return Math.min(HOOPS_MAX_SHOTS_A_DAY, Math.floor(Math.max(0, steps) / Math.max(1, shotSteps)));
}

// Steps to the next shot, or null once all five are earned.
export function hoopsStepsToNext(steps: number, shotSteps: number): number | null {
  const shots = hoopsShotsFor(steps, shotSteps);
  if (shots >= HOOPS_MAX_SHOTS_A_DAY) return null;
  return (shots + 1) * shotSteps - steps;
}

export function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

export function hoopsPeriodLabel(period: number, daysPerQuarter: number): string {
  const quarters = HOOPS_QUARTERS;
  const q = Math.ceil(period / Math.max(1, daysPerQuarter));
  if (q > quarters) return 'OT';
  return `Q${q}`;
}

// What happened on one shot, in a sentence.
export function hoopsPlayWords(e: {
  kind: HoopsEventKind;
  dunk: boolean;
  made: boolean;
  on_fire: boolean;
}, name: string): string {
  if (e.kind === 'ft') return e.made ? `${name} at the line. Good.` : `${name} at the line. No good.`;
  if (e.kind === 'putback') return e.made ? `${name} puts the rebound back in.` : `${name}’s putback rolls off.`;
  if (e.kind === 'drive') {
    if (e.dunk) return e.made ? `${name} dunks on the drive.` : `${name} goes up for the dunk. Blocked.`;
    return e.made ? `${name} drives and scores.` : `${name} drives. No good.`;
  }
  if (e.kind === 'mid') return e.made ? `${name} from mid-range. Good.` : `${name} from mid-range. Off the rim.`;
  return e.made ? (e.on_fire ? `${name} from three. On fire.` : `${name} from three. Swish.`) : `${name} from three. Rims out.`;
}

// ── H-O-R-S-E ──

export type HorseWord = 'HORSE' | 'PIG';
export const HORSE_WORDS: HorseWord[] = ['HORSE', 'PIG'];
export const HORSE_DAYS = 14;
export const HORSE_LENGTHS = [7, 14] as const;

export type HorseShotId = 'layup' | 'free_throw' | 'three' | 'hook' | 'half_court';
export const HORSE_SHOTS: { id: HorseShotId; name: string; target: number }[] = [
  { id: 'layup', name: 'Layup', target: 6000 },
  { id: 'free_throw', name: 'Free throw', target: 8000 },
  { id: 'three', name: 'Three', target: 10000 },
  { id: 'hook', name: 'Hook shot', target: 12000 },
  { id: 'half_court', name: 'Half-court', target: 15000 },
];

// "H-O-R-S-E" with dashes, as people say it.
export function spelled(word: string): string {
  return word.split('').join('-');
}

export function formatSteps(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}
