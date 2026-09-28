// Pure cosmetics data — no Supabase/RN imports, same discipline as
// bingo.ts/tictacgo.ts. Mirrors 0059_cosmetics.sql's own seeded
// cosmetic_items rows by hand (ids, slot, unlock_xp) — kept in sync the
// same "two lists, no generator" way bingo.ts's own BINGO_CATEGORIES
// already is with its migration's check constraint. The actual render
// colors (gradient stops, ring color) live only here — the database
// doesn't need to know what anything looks like, only what's unlocked.

export type CosmeticSlot = 'frame' | 'background' | 'icon';

export interface CosmeticItem {
  id: string;
  slot: CosmeticSlot;
  name: string;
  // Exactly one of these is ever set per item, mirroring cosmetic_items'
  // own unlock_xp/cost_bones XOR constraint (0060_bones_shop.sql): a
  // leveled item unlocks by reaching unlockXp; a shop item is bought
  // outright for costBones and no level ever unlocks it. Must match the
  // row's own values exactly — equip_cosmetic()/purchase_cosmetic() are
  // the real gates; these are only for what the Locker shows before
  // either RPC is ever called.
  unlockXp: number | null;
  costBones: number | null;
}

export interface FrameStyle extends CosmeticItem {
  slot: 'frame';
  ringColor: string;
}

export interface BackgroundStyle extends CosmeticItem {
  slot: 'background';
  // A 2-stop linear gradient, rendered behind the initials instead of
  // the plain flat tint.
  gradientFrom: string;
  gradientTo: string;
}

export interface IconStyle extends CosmeticItem {
  slot: 'icon';
  // A key into src/cosmetics/avatarIcons.ts's own ICON_COMPONENTS map,
  // not a component itself — this file stays free of RN/phosphor
  // imports, same discipline bingo.ts/tictacgo.ts already follow. When
  // equipped, this replaces the initials Avatar would otherwise show
  // (see Avatar.tsx); frame/background still layer around it unchanged.
  icon: string;
}

export const FRAMES: FrameStyle[] = [
  { id: 'frame_bronze', slot: 'frame', name: 'Bronze Ring', unlockXp: 450, costBones: null, ringColor: '#c17f4f' },
  { id: 'frame_silver', slot: 'frame', name: 'Silver Ring', unlockXp: 2450, costBones: null, ringColor: '#c4c8d6' },
  { id: 'frame_gold', slot: 'frame', name: 'Gold Ring', unlockXp: 7200, costBones: null, ringColor: '#e0b84f' },
  { id: 'frame_glow', slot: 'frame', name: 'Accent Glow', unlockXp: 16200, costBones: null, ringColor: '#9184d9' },
  { id: 'frame_diamond', slot: 'frame', name: 'Diamond Ring', unlockXp: 31250, costBones: null, ringColor: '#bdeafd' },
  // Shop-only — see 0060_bones_shop.sql. Bought outright with Bones, no
  // level ever unlocks these.
  { id: 'frame_neon', slot: 'frame', name: 'Neon Ring', unlockXp: null, costBones: 250, ringColor: '#39ff88' },
  { id: 'frame_shadow', slot: 'frame', name: 'Shadow Ring', unlockXp: null, costBones: 600, ringColor: '#2b2b33' },
];

export const BACKGROUNDS: BackgroundStyle[] = [
  {
    id: 'bg_sunset',
    slot: 'background',
    name: 'Sunset',
    unlockXp: 1250,
    costBones: null,
    gradientFrom: '#e0a94f',
    gradientTo: '#c1507f',
  },
  {
    id: 'bg_ocean',
    slot: 'background',
    name: 'Ocean',
    unlockXp: 5000,
    costBones: null,
    gradientFrom: '#4f9fe0',
    gradientTo: '#4fd3c4',
  },
  {
    id: 'bg_forest',
    slot: 'background',
    name: 'Forest',
    unlockXp: 11250,
    costBones: null,
    gradientFrom: '#4fbf7a',
    gradientTo: '#2f8f6a',
  },
  {
    id: 'bg_aurora',
    slot: 'background',
    name: 'Aurora',
    unlockXp: 20000,
    costBones: null,
    gradientFrom: '#9184d9',
    gradientTo: '#e04fb0',
  },
  {
    id: 'bg_midnight',
    slot: 'background',
    name: 'Midnight',
    unlockXp: 45000,
    costBones: null,
    gradientFrom: '#232532',
    gradientTo: '#0d0e14',
  },
  // Shop-only — see 0060_bones_shop.sql.
  {
    id: 'bg_galaxy',
    slot: 'background',
    name: 'Galaxy',
    unlockXp: null,
    costBones: 400,
    gradientFrom: '#1b1035',
    gradientTo: '#6a3fd1',
  },
  {
    id: 'bg_lava',
    slot: 'background',
    name: 'Lava',
    unlockXp: null,
    costBones: 900,
    gradientFrom: '#3a0d02',
    gradientTo: '#ff4d1c',
  },
];

// Mirrors 0069_avatar_icon_cosmetics.sql's own seeded icon rows — see
// that migration's own comment for why a curated set (not a custom photo
// upload) is this feature's scope.
export const ICONS: IconStyle[] = [
  { id: 'icon_paw', slot: 'icon', name: 'Paw Print', unlockXp: 800, costBones: null, icon: 'paw' },
  { id: 'icon_dog', slot: 'icon', name: 'Dog', unlockXp: 4050, costBones: null, icon: 'dog' },
  { id: 'icon_cat', slot: 'icon', name: 'Cat', unlockXp: 9800, costBones: null, icon: 'cat' },
  { id: 'icon_rabbit', slot: 'icon', name: 'Rabbit', unlockXp: 20000, costBones: null, icon: 'rabbit' },
  { id: 'icon_fire', slot: 'icon', name: 'Fire', unlockXp: 36450, costBones: null, icon: 'fire' },
  // Shop-only — see 0069_avatar_icon_cosmetics.sql.
  { id: 'icon_robot', slot: 'icon', name: 'Robot', unlockXp: null, costBones: 300, icon: 'robot' },
  { id: 'icon_rocket', slot: 'icon', name: 'Rocket', unlockXp: null, costBones: 550, icon: 'rocket' },
  { id: 'icon_crown', slot: 'icon', name: 'Crown', unlockXp: null, costBones: 800, icon: 'crown' },
];

const FRAMES_BY_ID = new Map(FRAMES.map((f) => [f.id, f] as const));
const BACKGROUNDS_BY_ID = new Map(BACKGROUNDS.map((b) => [b.id, b] as const));
const ICONS_BY_ID = new Map(ICONS.map((i) => [i.id, i] as const));

export function frameById(id: string | null | undefined): FrameStyle | null {
  return id ? (FRAMES_BY_ID.get(id) ?? null) : null;
}

export function backgroundById(id: string | null | undefined): BackgroundStyle | null {
  return id ? (BACKGROUNDS_BY_ID.get(id) ?? null) : null;
}

export function iconStyleById(id: string | null | undefined): IconStyle | null {
  return id ? (ICONS_BY_ID.get(id) ?? null) : null;
}
