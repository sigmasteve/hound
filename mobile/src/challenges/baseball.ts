// Pure rules and words for Baseball — no Supabase/RN imports, same as
// cricket.ts. The server (0167_baseball.sql) plays every inning; this
// file owns how a game reads on a screen.

export type BaseballPos = 'p' | 'c' | '1b' | '2b' | 'ss' | '3b' | 'lf' | 'cf' | 'rf';
export type BaseballZone = 'left' | 'center' | 'right';
export type BaseballApproach = 'power' | 'finesse';
export type BaseballPlayKind =
  | 'strikeout'
  | 'walk'
  | 'single'
  | 'double'
  | 'triple'
  | 'home_run'
  | 'ground_out'
  | 'fly_out'
  | 'double_play'
  | 'sac_fly'
  | 'out_at_home'
  | 'stolen_base'
  | 'caught_stealing';

export const BASEBALL_INNINGS = [3, 5, 7, 9] as const;
export const DEFAULT_BASEBALL_INNINGS = 9;
export const BASEBALL_MAX_SIDE = 9;

// The order positions are handed out in, round again on a smaller side
// (0167's baseball_assign_positions).
export const POSITION_ORDER: BaseballPos[] = ['p', 'c', 'ss', 'cf', '2b', '3b', 'lf', '1b', 'rf'];

export const POSITION_NAMES: Record<BaseballPos, string> = {
  p: 'Pitcher',
  c: 'Catcher',
  '1b': 'First base',
  '2b': 'Second base',
  ss: 'Shortstop',
  '3b': 'Third base',
  lf: 'Left field',
  cf: 'Center field',
  rf: 'Right field',
};

export const POSITION_SHORT: Record<BaseballPos, string> = {
  p: 'P',
  c: 'C',
  '1b': '1B',
  '2b': '2B',
  ss: 'SS',
  '3b': '3B',
  lf: 'LF',
  cf: 'CF',
  rf: 'RF',
};

export const ZONE_NAMES: Record<BaseballZone, string> = { left: 'Left', center: 'Center', right: 'Right' };

// The positions a side of `n` players hands to the player at batting
// position `seat` (from 1).
export function positionsFor(seat: number, n: number): BaseballPos[] {
  return POSITION_ORDER.filter((_, i) => i % Math.max(1, n) === seat - 1);
}

export function isHit(kind: BaseballPlayKind): boolean {
  return kind === 'single' || kind === 'double' || kind === 'triple' || kind === 'home_run';
}

// Counts as an at-bat (walks and sacrifice flies don't).
export function isAtBat(kind: BaseballPlayKind): boolean {
  return isHit(kind) || kind === 'strikeout' || kind === 'ground_out' || kind === 'fly_out' || kind === 'double_play';
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${s ?? 'th'}`;
}

export function inningLabel(inning: number, innings: number): string {
  return inning > innings ? `${ordinal(inning)} (extra)` : ordinal(inning);
}

// A few words for a play, in the morning report: "doubled to right",
// "grounded out to short". `who` is the batter (or runner), `field` the
// fielder's name when there is one.
const FIELD_WORDS: Record<string, string> = {
  p: 'the pitcher',
  c: 'the catcher',
  '1b': 'first',
  '2b': 'second',
  ss: 'short',
  '3b': 'third',
  lf: 'left',
  cf: 'center',
  rf: 'right',
};

export function playWords(
  kind: BaseballPlayKind,
  pos: string | null,
  aim: BaseballZone | null,
  lateThrow: boolean,
  runs: number,
  seed: number,
): string {
  const where = pos ? FIELD_WORDS[pos] ?? pos : aim ? aim : 'the field';
  const scored = runs > 0 ? `, ${runs} ${runs === 1 ? 'run scores' : 'runs score'}` : '';
  switch (kind) {
    case 'strikeout':
      return seed % 3 === 0 ? 'struck out looking' : 'struck out swinging';
    case 'walk':
      return `walked${scored}`;
    case 'single':
      return `singled to ${where}${scored}`;
    case 'double':
      return `${lateThrow ? 'doubled, with a late throw,' : 'doubled'} to ${where}${scored}`;
    case 'triple':
      return `${lateThrow ? 'tripled, with a late throw,' : 'tripled'} to ${where}${scored}`;
    case 'home_run':
      return lateThrow
        ? `hit an inside-the-park home run${runs > 1 ? `, ${runs} runs` : ''}`
        : runs === 4
          ? 'hit a grand slam'
          : `homered to ${aim ?? 'center'}${runs > 1 ? `, ${runs} runs` : ''}`;
    case 'ground_out':
      return `grounded out to ${where}`;
    case 'fly_out':
      return `flied out to ${where}`;
    case 'double_play':
      return `grounded into a double play to ${where}`;
    case 'sac_fly':
      return `hit a sacrifice fly to ${where}, a run scores`;
    case 'out_at_home':
      return 'was tagged out at home';
    case 'stolen_base':
      return 'stole a base';
    case 'caught_stealing':
      return 'was caught stealing';
  }
}

// The outcome chip on a play: "1B", "HR", "K".
export const PLAY_SHORT: Record<BaseballPlayKind, string> = {
  strikeout: 'K',
  walk: 'BB',
  single: '1B',
  double: '2B',
  triple: '3B',
  home_run: 'HR',
  ground_out: 'GO',
  fly_out: 'FO',
  double_play: 'DP',
  sac_fly: 'SF',
  out_at_home: 'Out',
  stolen_base: 'SB',
  caught_stealing: 'CS',
};

export function formatSteps(n: number): string {
  return `${Math.round(n).toLocaleString()} steps`;
}

// A small stable number from a string, for wording that shouldn't change
// between renders.
export function seedOf(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}
