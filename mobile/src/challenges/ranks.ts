import { levelProgressForXp } from './leveling';

// Hound ranks: what your level makes you, shown on your avatar
// everywhere (a level badge in the rank's color) and celebrated when it
// changes (LevelUpModal). Separate from the Locker: you choose Locker
// items, but your rank comes only from playing, and can't be bought.

export interface Rank {
  id: 'pup' | 'tracker' | 'hunter' | 'alpha' | 'legend';
  name: string;
  minLevel: number;
  color: string;
}

export const RANKS: Rank[] = [
  { id: 'pup', name: 'Pup', minLevel: 0, color: '#8a8fa3' },
  { id: 'tracker', name: 'Tracker', minLevel: 5, color: '#c17f4f' },
  { id: 'hunter', name: 'Hunter', minLevel: 10, color: '#4f9fe0' },
  { id: 'alpha', name: 'Alpha', minLevel: 15, color: '#e0b84f' },
  { id: 'legend', name: 'Legend', minLevel: 20, color: '#9184d9' },
];

export function rankForLevel(level: number): Rank {
  let rank = RANKS[0];
  for (const r of RANKS) if (level >= r.minLevel) rank = r;
  return rank;
}

export function levelForXp(xpTotal: number | null | undefined): number | null {
  return xpTotal == null ? null : levelProgressForXp(xpTotal).level;
}
