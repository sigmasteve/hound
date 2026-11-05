// Pack Wars: four packs, one shared map. Pure rules and wording here, no
// Supabase or React Native imports.
//
// Everyone who joins is put in one of four packs, keeping them even.
// Each day a member votes where their pack marches: a territory next to
// one it holds, or Hold to defend. Only members who voted that day add
// their steps, averaged over the pack's members so a big pack doesn't win
// on numbers alone. Overnight, each pack marches on its most-voted spot,
// and every contested territory goes to whoever put the most on it.
// Most territory at the end wins.

export type PackId = 'red' | 'blue' | 'gold' | 'green';

export interface Pack {
  id: PackId;
  name: string;
  color: string;
  // A lighter wash for owned ground.
  wash: string;
}

export const PACKS: Pack[] = [
  { id: 'red', name: 'Red Setters', color: '#c8463d', wash: '#f2c4bf' },
  { id: 'blue', name: 'Blue Heelers', color: '#3a72c4', wash: '#c3d6f2' },
  { id: 'gold', name: 'Golden Retrievers', color: '#d39b22', wash: '#f4dfae' },
  { id: 'green', name: 'Border Collies', color: '#2f8a57', wash: '#bfe3cc' },
];

export const packOf = (id: PackId) => PACKS.find((p) => p.id === id)!;

// The map: 6 across, 4 down. Each pack starts in a corner.
export const MAP_COLS = 6;
export const MAP_ROWS = 4;

export const TERRITORY_NAMES = [
  'Oak Hollow', 'Maple Park', 'Creek Loop', 'Lake Path', 'Fox Hill', 'Pine Ridge',
  'Elm Square', 'Birch Lane', 'Mill Pond', 'Dog Run', 'Cedar Commons', 'Harbor Walk',
  'Rose Garden', 'Willow Bend', 'Stone Bridge', 'Meadow Field', 'Orchard Row', 'Hilltop',
  'Old Mill', 'Riverside', 'Clover Lot', 'Market Square', 'Bluebell Green', 'Sunset Pier',
];

export interface Territory {
  idx: number;
  name: string;
  owner: PackId | null;
}

export function neighbors(idx: number): number[] {
  const r = Math.floor(idx / MAP_COLS);
  const c = idx % MAP_COLS;
  const out: number[] = [];
  if (r > 0) out.push(idx - MAP_COLS);
  if (r < MAP_ROWS - 1) out.push(idx + MAP_COLS);
  if (c > 0) out.push(idx - 1);
  if (c < MAP_COLS - 1) out.push(idx + 1);
  return out;
}

// Where a pack can march: anything next to ground it holds that it
// doesn't hold already.
export function marchable(map: Territory[], pack: PackId): Set<number> {
  const out = new Set<number>();
  for (const t of map) {
    if (t.owner !== pack) continue;
    for (const n of neighbors(t.idx)) if (map[n].owner !== pack) out.add(n);
  }
  return out;
}
