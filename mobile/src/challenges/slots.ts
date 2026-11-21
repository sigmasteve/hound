// Paw Slots (0242): the machine's parts. The server picks where the reels
// stop and pays every line; the app draws the same reels in the same
// order (slots_strip) and turns them to where the server says. Mockup:
// claude.ai/artifact/PQ5Sv4xveiiTj5T9o39Jzh.

export type SlotSymbol = 'paw' | 'hydrant' | 'treat' | 'ball' | 'bone' | 'collar' | 'gold';

// Top to bottom as they pass; slots_strip has the same three.
export const STRIPS: SlotSymbol[][] = [
  ['hydrant', 'paw', 'bone', 'paw', 'paw', 'treat', 'paw', 'collar', 'hydrant', 'paw', 'paw', 'ball', 'hydrant', 'collar', 'hydrant', 'hydrant', 'gold', 'treat', 'ball', 'treat'],
  ['collar', 'treat', 'paw', 'paw', 'hydrant', 'hydrant', 'ball', 'bone', 'paw', 'hydrant', 'collar', 'hydrant', 'treat', 'gold', 'ball', 'paw', 'hydrant', 'treat', 'paw', 'paw'],
  ['collar', 'paw', 'ball', 'paw', 'collar', 'hydrant', 'ball', 'hydrant', 'paw', 'treat', 'treat', 'gold', 'hydrant', 'paw', 'paw', 'hydrant', 'bone', 'hydrant', 'treat', 'paw'],
];
export const STRIP_LEN = 20;

const mod = (a: number, n: number) => ((a % n) + n) % n;

// The symbol in a row (0 top, 1 the middle, 2 the bottom) of a reel at a
// stop: the middle row is the stop itself (slots_symbol).
export function symbolAt(reel: number, stop: number, row: number): SlotSymbol {
  return STRIPS[reel][mod(stop + 1 - row, STRIP_LEN)];
}

// The five lines, as the row on each reel: the middle, top, bottom, then
// the two diagonals (slots_line_rows).
export const LINES: [number, number, number][] = [
  [1, 1, 1],
  [0, 0, 0],
  [2, 2, 2],
  [0, 1, 2],
  [2, 1, 0],
];
export const LINE_COLORS = ['#e05b5b', '#f08a24', '#4f7be0', '#7fd39b', '#d97fb8'];
export const LINE_CHOICES = [1, 3, 5] as const;
export const BET_CHOICES = [1, 2, 3, 5] as const;
export type SlotLines = (typeof LINE_CHOICES)[number];
export type SlotBet = (typeof BET_CHOICES)[number];

export const NAMES: Record<SlotSymbol, { one: string; many: string }> = {
  gold: { one: 'Golden Hound', many: 'Golden Hounds' },
  bone: { one: 'Bone', many: 'Bones' },
  ball: { one: 'Ball', many: 'Balls' },
  treat: { one: 'Treat', many: 'Treats' },
  hydrant: { one: 'Hydrant', many: 'Hydrants' },
  paw: { one: 'Paw', many: 'Paws' },
  collar: { one: 'Collar', many: 'Collars' },
};

// What a line won, as the server sends it (slots_pay plus the line).
export interface SlotWin {
  line: number;
  n: number;
  kind: 'three' | 'two';
  sym: SlotSymbol;
  k: number;
  collar: boolean;
}

export function toWin(w: any): SlotWin {
  return {
    line: Number(w?.line ?? 1),
    n: Number(w?.n ?? 0),
    kind: w?.kind === 'two' ? 'two' : 'three',
    sym: (w?.sym ?? 'paw') as SlotSymbol,
    k: Number(w?.k ?? 3),
    collar: !!w?.collar,
  };
}

// "Three Bones, doubled by the Collar".
export function winName(w: SlotWin): string {
  const what = w.kind === 'three' ? `Three ${NAMES[w.sym].many}` : `Two ${NAMES[w.sym].many} on the left`;
  return w.collar ? `${what}, doubled by the Collar` : what;
}

// The paytable for Help and the machine (odds per line, from every stop).
export const PAYTABLE: { sym: SlotSymbol | 'any'; count: number; name: string; pays: number; odds: string }[] = [
  { sym: 'gold', count: 3, name: 'Golden Hounds', pays: 250, odds: '1 in 8,000' },
  { sym: 'collar', count: 3, name: 'Collars', pays: 100, odds: '1 in 1,000' },
  { sym: 'bone', count: 3, name: 'Bones', pays: 50, odds: '1 in 420' },
  { sym: 'ball', count: 3, name: 'Balls', pays: 25, odds: '1 in 140' },
  { sym: 'treat', count: 3, name: 'Treats', pays: 15, odds: '1 in 70' },
  { sym: 'hydrant', count: 3, name: 'Hydrants', pays: 10, odds: '1 in 24' },
  { sym: 'paw', count: 3, name: 'Paws', pays: 5, odds: '1 in 16' },
  { sym: 'any', count: 2, name: 'Any 2 on the left', pays: 2, odds: '1 in 4' },
];

// How often a press wins something, by lines played.
export const HIT_RATE: Record<SlotLines, string> = { 1: '3 in 8', 3: '7 in 9', 5: '17 in 20' };

export const TEAMS = ['wolves', 'goldens', 'collies', 'beagles'] as const;
export type SlotTeam = (typeof TEAMS)[number];
export const TEAM_NAME: Record<SlotTeam, string> = { wolves: 'Wolves', goldens: 'Goldens', collies: 'Collies', beagles: 'Beagles' };
export const TEAM_COLOR: Record<SlotTeam, string> = { wolves: '#8a93a8', goldens: '#f0c24a', collies: '#4f7be0', beagles: '#c08a52' };

export function teamName(t: string | null | undefined): string {
  return t && t in TEAM_NAME ? TEAM_NAME[t as SlotTeam] : '';
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
