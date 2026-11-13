// Pure rules and words for Golf — no Supabase/RN imports, same as
// hoops.ts. The server (0200_golf.sql) plays every shot and keeps the
// banks; this file owns the clubs, the caddie, and how a round reads.

export type GolfClubId = 'driver' | 'wood' | 'i5' | 'i7' | 'i9' | 'wedge' | 'putter';
export type GolfFormat = 'stroke' | 'skins' | 'match';
export type GolfCourseId = 'links' | 'desert' | 'park' | 'mountain';
export type GolfLie = 'tee' | 'fairway' | 'rough' | 'bunker' | 'green' | 'water' | 'out' | 'waste' | 'trees' | 'holed';

export interface GolfClub {
  id: GolfClubId;
  name: string;
  max: number;
  spread: number;
}

// Longest first is how a bag reads; the caddie walks it shortest first.
export const GOLF_CLUBS: GolfClub[] = [
  { id: 'driver', name: 'Driver', max: 250, spread: 1 },
  { id: 'wood', name: '3-wood', max: 225, spread: 0.85 },
  { id: 'i5', name: '5-iron', max: 190, spread: 0.7 },
  { id: 'i7', name: '7-iron', max: 160, spread: 0.6 },
  { id: 'i9', name: '9-iron', max: 130, spread: 0.5 },
  { id: 'wedge', name: 'Wedge', max: 100, spread: 0.4 },
  { id: 'putter', name: 'Putter', max: 30, spread: 0.12 },
];

export function golfClub(id: GolfClubId): GolfClub {
  return GOLF_CLUBS.find((c) => c.id === id) ?? GOLF_CLUBS[0];
}

// The longest a full pull goes off the green.
export const GOLF_PULL_MAX = 250;
export const GOLF_POWER_STEPS = [0, 10, 20, 30] as const;
export const GOLF_STEPS_PER_YARD = 10;
export const GOLF_HOLES_PER_DAY = 3;

// The caddie: the shortest club that reaches, the driver past that.
export function caddieClub(yards: number): GolfClub {
  const list = GOLF_CLUBS.filter((c) => c.id !== 'putter').sort((a, b) => a.max - b.max);
  return list.find((c) => c.max >= yards) ?? list[list.length - 1];
}

export const GOLF_FORMAT_NAME: Record<GolfFormat, string> = { stroke: 'Stroke play', skins: 'Skins', match: 'Match play' };
export const GOLF_FORMAT_NOTE: Record<GolfFormat, string> = {
  stroke: 'Fewest strokes wins',
  skins: 'Bones each hole, ties carry',
  match: 'One on one, hole by hole',
};

export const GOLF_COURSES: { id: GolfCourseId; name: string; note: string }[] = [
  { id: 'links', name: 'Seaside Links', note: 'Wind off the sea, pot bunkers' },
  { id: 'desert', name: 'Canyon Desert', note: 'Carries over sand' },
  { id: 'park', name: 'Lakeside Park', note: 'Trees and water' },
  { id: 'mountain', name: 'Ridge Mountain', note: 'Big drops, thin air' },
];

export function golfCourseName(id: string): string {
  return GOLF_COURSES.find((c) => c.id === id)?.name ?? 'The course';
}

export const GOLF_LIE_NAME: Record<string, string> = {
  tee: 'Tee',
  fairway: 'Fairway',
  rough: 'Rough',
  bunker: 'Bunker',
  green: 'Green',
  water: 'Water',
  out: 'Out of bounds',
  waste: 'Waste area',
  trees: 'Trees',
  holed: 'In the hole',
};

// 9 holes over 4 days, 18 over 7.
export function golfDays(holes: number): number {
  return holes >= 18 ? 7 : 4;
}

// "−2", "E", "+3".
export function toParText(n: number | null | undefined): string {
  if (n == null) return '';
  if (n === 0) return 'E';
  return n > 0 ? `+${n}` : `−${-n}`;
}

// A hole's score against par, in words.
export function scoreWord(strokes: number, par: number): string {
  if (strokes === 1) return 'Hole in one!';
  const d = strokes - par;
  if (d <= -3) return 'Albatross!';
  if (d === -2) return 'Eagle!';
  if (d === -1) return 'Birdie!';
  if (d === 0) return 'Par';
  if (d === 1) return 'Bogey';
  if (d === 2) return 'Double bogey';
  return `+${d}`;
}

// "1st", "2nd", "3rd", "4th"… for hole numbers in messages.
export function ordinal(n: number): string {
  const s = n % 100;
  if (s >= 11 && s <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`;
}

// Yards, or feet once you're close.
export function distanceText(yards: number): string {
  return yards < 30 ? `${Math.round(yards * 3)} ft` : `${Math.round(yards)} yd`;
}
