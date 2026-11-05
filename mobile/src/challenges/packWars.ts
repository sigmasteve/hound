// Pack Wars: four packs, one neighborhood map. Pure rules and wording
// here, no Supabase or React Native imports. The game itself is
// 0174_pack_wars.sql.
//
// Everyone who joins is put in the smallest pack. Each day a member votes
// where their pack marches: a territory next to ground it holds, or Hold
// to defend. Only members who voted add their steps, over all the pack's
// members. Overnight each pack marches on its most-voted spot; a
// territory goes to the strongest pack on it that beats the owner's
// defence (all of its strength on a Hold, half while marching). Most
// ground at the end wins.

export type PackId = 'wolves' | 'goldens' | 'collies' | 'beagles';

export interface Pack {
  id: PackId;
  name: string;
  // "You're a Wolf".
  one: string;
  color: string;
  // A lighter wash for held ground.
  wash: string;
}

// Map colours are fixed, not themed, like the Hound'opoly board's.
export const PACKS: Pack[] = [
  { id: 'wolves', name: 'Wolves', one: 'Wolf', color: '#4a6a9c', wash: '#c9d5e8' },
  { id: 'goldens', name: 'Golden Retrievers', one: 'Golden Retriever', color: '#d39b22', wash: '#f4dfae' },
  { id: 'collies', name: 'Border Collies', one: 'Border Collie', color: '#2f8a57', wash: '#bfe3cc' },
  { id: 'beagles', name: 'Beagles', one: 'Beagle', color: '#b5532e', wash: '#efc7b6' },
];

export const packOf = (id: PackId) => PACKS.find((p) => p.id === id)!;

// The map: 6 across, 4 down, numbered row by row from the top left. Each
// pack starts on a corner (Wolves 0, Goldens 5, Collies 18, Beagles 23).
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

// Up, down, left and right (the server's pack_neighbors).
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

// Where a pack can march (the server's pack_can_march): ground it doesn't
// hold next to ground it does; anywhere, once it holds nothing.
export function marchable(map: Territory[], pack: PackId): Set<number> {
  const out = new Set<number>();
  const holds = map.some((t) => t.owner === pack);
  for (const t of map) {
    if (t.owner === pack) continue;
    if (!holds || neighbors(t.idx).some((n) => map[n]?.owner === pack)) out.add(t.idx);
  }
  return out;
}
