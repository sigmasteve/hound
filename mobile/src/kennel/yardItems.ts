// The Yard (0148_yard.sql). Mirrors its kennel_items rows by hand (ids,
// slot, name, price); buy_kennel_item and place_yard_item are the real
// checks. How each one looks lives in YardArt.tsx.

export type YardSlot = 'house' | 'bed' | 'bowl' | 'toy' | 'plant' | 'fence' | 'ground' | 'tree' | 'pond';

// The Porch (0157): unlocked once, then each item has its own place on it.
export const PORCH_UNLOCK = { id: 'zone_porch', name: 'The Porch', costBones: 1500, minLevel: 10 };
export const PORCH_ITEMS: { id: string; name: string; costBones: number; note: string }[] = [
  { id: 'porch_hottub', name: 'Hot Tub', costBones: 1200, note: 'Your hound sits in it, with bubbles' },
  { id: 'porch_lounge', name: 'Lounge Chair', costBones: 300, note: 'For naps in the sun' },
  { id: 'porch_swing', name: 'Porch Swing', costBones: 350, note: 'Swings, slowly' },
  { id: 'porch_firepit', name: 'Fire Pit', costBones: 400, note: 'Lit at night; your hound lies by it' },
  { id: 'porch_umbrella', name: 'Patio Umbrella', costBones: 200, note: 'Shades the lounge chair' },
  { id: 'porch_grill', name: 'Grill', costBones: 250, note: 'Your hound sits by it, hopefully' },
];
export type YardSpot = 'house' | 'bed' | 'bowl' | 'toy' | 'plant_left' | 'plant_right' | 'fence' | 'ground' | 'tree' | 'pond';

export interface YardItem {
  id: string;
  slot: YardSlot;
  name: string;
  // 0 is free: every slot has one, shown until you change it.
  costBones: number;
  // Limited-time ones (0149_yard_seasons.sql), like the Kennel's: the
  // season, and the first and last days it can be bought (YYYY-MM-DD,
  // the member's own). Owned ones stay for good.
  season?: string;
  availableFrom?: string;
  availableUntil?: string;
}

export const YARD_ITEMS: YardItem[] = [
  { id: 'house_classic', slot: 'house', name: 'Hound House', costBones: 0 },
  { id: 'house_barn', slot: 'house', name: 'Red Barn', costBones: 120 },
  { id: 'house_cabin', slot: 'house', name: 'Log Cabin', costBones: 200 },
  // The bougie houses (0157).
  { id: 'house_bungalow', slot: 'house', name: 'Beach Bungalow', costBones: 800 },
  { id: 'house_glass', slot: 'house', name: 'Modern Glass House', costBones: 900 },
  { id: 'house_treehouse', slot: 'house', name: 'Treehouse', costBones: 1000 },
  { id: 'house_castle', slot: 'house', name: 'Castle', costBones: 1500 },
  { id: 'house_mansion', slot: 'house', name: 'Doghouse Mansion', costBones: 2500 },
  { id: 'bed_cushion', slot: 'bed', name: 'Cushion', costBones: 0 },
  { id: 'bed_donut', slot: 'bed', name: 'Donut Bed', costBones: 60 },
  { id: 'bed_hammock', slot: 'bed', name: 'Hammock', costBones: 150 },
  { id: 'bowl_classic', slot: 'bowl', name: 'Hound Bowl', costBones: 0 },
  { id: 'bowl_gold', slot: 'bowl', name: 'Gold Bowl', costBones: 100 },
  { id: 'toy_ball', slot: 'toy', name: 'Tennis Ball', costBones: 0 },
  { id: 'toy_rope', slot: 'toy', name: 'Rope Toy', costBones: 40 },
  { id: 'toy_duck', slot: 'toy', name: 'Rubber Duck', costBones: 60 },
  { id: 'plant_fern', slot: 'plant', name: 'Fern', costBones: 0 },
  { id: 'plant_sunflower', slot: 'plant', name: 'Sunflower', costBones: 40 },
  { id: 'plant_cactus', slot: 'plant', name: 'Cactus', costBones: 60 },
  { id: 'fence_plain', slot: 'fence', name: 'Plain Fence', costBones: 0 },
  { id: 'fence_bunting', slot: 'fence', name: 'Bunting', costBones: 50 },
  { id: 'fence_lights', slot: 'fence', name: 'String Lights', costBones: 90 },
  { id: 'ground_grass', slot: 'ground', name: 'Just Grass', costBones: 0 },
  { id: 'ground_stones', slot: 'ground', name: 'Stepping Stones', costBones: 40 },
  { id: 'ground_flowers', slot: 'ground', name: 'Flower Bed', costBones: 80 },
  { id: 'tree_oak', slot: 'tree', name: 'Oak', costBones: 0 },
  { id: 'tree_cherry', slot: 'tree', name: 'Cherry Blossom', costBones: 150 },
  { id: 'pond_lily', slot: 'pond', name: 'Lily Pond', costBones: 0 },
  { id: 'pond_fountain', slot: 'pond', name: 'Fountain', costBones: 200 },
  // Autumn 2026, through November.
  { id: 'ground_pumpkins', slot: 'ground', name: 'Pumpkin Patch', costBones: 80, season: 'Autumn', availableFrom: '2026-11-01', availableUntil: '2026-11-30' },
  // Winter 2026, Nov 15 to Dec 31 (0149, and 0156's Igloo and Lit Tree).
  ...(
    [
      { id: 'house_gingerbread', slot: 'house', name: 'Gingerbread House', costBones: 200 },
      { id: 'ground_snowman', slot: 'ground', name: 'Snowman', costBones: 100 },
      { id: 'fence_garland', slot: 'fence', name: 'Holiday Garland', costBones: 60 },
      { id: 'house_igloo', slot: 'house', name: 'Igloo', costBones: 300 },
      { id: 'tree_lit', slot: 'tree', name: 'Lit Tree', costBones: 180 },
    ] as const
  ).map((i) => ({ ...i, season: 'Winter', availableFrom: '2026-11-15', availableUntil: '2026-12-31' })),
];

// Whether it's for sale on this day (YYYY-MM-DD, the member's own).
export function yardItemOnSale(item: YardItem, dayKey: string): boolean {
  return (!item.availableFrom || dayKey >= item.availableFrom) && (!item.availableUntil || dayKey <= item.availableUntil);
}

// "Until Nov 30", for a limited-time one.
export function yardSaleEnds(item: YardItem): string | null {
  if (!item.availableUntil) return null;
  const [y, m, d] = item.availableUntil.split('-').map(Number);
  return `Until ${new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

const BY_ID = new Map(YARD_ITEMS.map((i) => [i.id, i] as const));

export function yardItemById(id: string | null | undefined): YardItem | null {
  return id ? (BY_ID.get(id) ?? null) : null;
}

export function spotSlot(spot: YardSpot): YardSlot {
  return spot === 'plant_left' || spot === 'plant_right' ? 'plant' : spot;
}

export function freeItemFor(spot: YardSpot): YardItem {
  return YARD_ITEMS.find((i) => i.slot === spotSlot(spot) && i.costBones === 0)!;
}

// Every spot, in the order Decorate lists them, with the yard size it
// opens at (0 Pup to 4 Legend, as yard_spots in 0148).
export const YARD_SPOTS: { spot: YardSpot; label: string; opensAt: number }[] = [
  { spot: 'house', label: 'House', opensAt: 0 },
  { spot: 'bed', label: 'Bed', opensAt: 0 },
  { spot: 'bowl', label: 'Bowl', opensAt: 0 },
  { spot: 'toy', label: 'Toy', opensAt: 0 },
  { spot: 'plant_left', label: 'Left plant', opensAt: 1 },
  { spot: 'ground', label: 'Ground', opensAt: 1 },
  { spot: 'plant_right', label: 'Right plant', opensAt: 2 },
  { spot: 'fence', label: 'Fence', opensAt: 2 },
  { spot: 'tree', label: 'Tree', opensAt: 3 },
  { spot: 'pond', label: 'Pond', opensAt: 4 },
];

// How the yard grows with your rank: its name, and how much of the
// world (YardArt's 540-wide drawing) it takes in. Trophy room is size + 1.
export const YARD_SIZES: { name: string; rank: string; left: number; width: number }[] = [
  { name: 'Puppy pen', rank: 'Pup', left: 120, width: 300 },
  { name: 'Backyard', rank: 'Tracker', left: 90, width: 360 },
  { name: 'Big backyard', rank: 'Hunter', left: 55, width: 430 },
  { name: 'Garden', rank: 'Alpha', left: 30, width: 480 },
  { name: 'Estate', rank: 'Legend', left: 0, width: 540 },
];

export function trophyRoom(size: number): number {
  return size + 1;
}

// What a yard of the next size adds, for "Rank up for a bigger yard".
export function nextSizeLine(size: number): string | null {
  if (size >= YARD_SIZES.length - 1) return null;
  const next = YARD_SIZES[size + 1];
  const spots = YARD_SPOTS.filter((s) => s.opensAt === size + 1).map((s) => s.label.toLowerCase());
  return `At ${next.rank}: a ${next.name.toLowerCase()}, with ${spots.join(' and ')} spots and room for ${trophyRoom(size + 1)} trophies.`;
}

// Trophies (0148's yard_trophies): won, never bought.
export type TrophyKind = 'steps' | 'houndopoly' | 'soccer' | 'rally' | 'cricket' | 'baseball' | 'tictacgo' | 'bingo' | 'streak' | 'journey';

export const TROPHIES: Record<TrophyKind, { name: string; how: string }> = {
  steps: { name: 'Step Race cup', how: 'Win a Step Race' },
  houndopoly: { name: "Hound'opoly top hat", how: "Win a game of Hound'opoly" },
  soccer: { name: 'Soccer goal', how: 'Win a Soccer match' },
  rally: { name: 'Rally racquet', how: 'Win a Rally' },
  cricket: { name: 'Cricket stumps', how: 'Win a Cricket match' },
  baseball: { name: 'Bat and ball', how: 'Win a Baseball game' },
  tictacgo: { name: 'Tic-Tac-Go board', how: 'Win a Tic-Tac-Go' },
  bingo: { name: 'Bingo card', how: 'Get the first BINGO, or a blackout' },
  streak: { name: 'Streak torch', how: 'Survive a Daily Streak' },
  journey: { name: 'Journey postcard', how: 'Finish a Journey' },
};

export const TROPHY_ORDER = Object.keys(TROPHIES) as TrophyKind[];
