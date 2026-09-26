// Pure cosmetics data — no Supabase/RN imports, same discipline as
// bingo.ts/tictacgo.ts. Mirrors 0059_cosmetics.sql's own seeded
// cosmetic_items rows by hand (ids, slot, unlock_xp) — kept in sync the
// same "two lists, no generator" way bingo.ts's own BINGO_CATEGORIES
// already is with its migration's check constraint. The actual render
// colors (gradient stops, ring color) live only here — the database
// doesn't need to know what anything looks like, only what's unlocked.

export type CosmeticSlot = 'frame' | 'background';

export interface CosmeticItem {
  id: string;
  slot: CosmeticSlot;
  name: string;
  // Must match the row's own unlock_xp in 0059_cosmetics.sql exactly —
  // equip_cosmetic() is the real gate; this is only for showing "Lv X"
  // in the Locker before that RPC is ever called.
  unlockXp: number;
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

export const FRAMES: FrameStyle[] = [
  { id: 'frame_bronze', slot: 'frame', name: 'Bronze Ring', unlockXp: 450, ringColor: '#c17f4f' },
  { id: 'frame_silver', slot: 'frame', name: 'Silver Ring', unlockXp: 2450, ringColor: '#c4c8d6' },
  { id: 'frame_gold', slot: 'frame', name: 'Gold Ring', unlockXp: 7200, ringColor: '#e0b84f' },
  { id: 'frame_glow', slot: 'frame', name: 'Accent Glow', unlockXp: 16200, ringColor: '#9184d9' },
  { id: 'frame_diamond', slot: 'frame', name: 'Diamond Ring', unlockXp: 31250, ringColor: '#bdeafd' },
];

export const BACKGROUNDS: BackgroundStyle[] = [
  { id: 'bg_sunset', slot: 'background', name: 'Sunset', unlockXp: 1250, gradientFrom: '#e0a94f', gradientTo: '#c1507f' },
  { id: 'bg_ocean', slot: 'background', name: 'Ocean', unlockXp: 5000, gradientFrom: '#4f9fe0', gradientTo: '#4fd3c4' },
  { id: 'bg_forest', slot: 'background', name: 'Forest', unlockXp: 11250, gradientFrom: '#4fbf7a', gradientTo: '#2f8f6a' },
  { id: 'bg_aurora', slot: 'background', name: 'Aurora', unlockXp: 20000, gradientFrom: '#9184d9', gradientTo: '#e04fb0' },
  { id: 'bg_midnight', slot: 'background', name: 'Midnight', unlockXp: 45000, gradientFrom: '#232532', gradientTo: '#0d0e14' },
];

const FRAMES_BY_ID = new Map(FRAMES.map((f) => [f.id, f] as const));
const BACKGROUNDS_BY_ID = new Map(BACKGROUNDS.map((b) => [b.id, b] as const));

export function frameById(id: string | null | undefined): FrameStyle | null {
  return id ? (FRAMES_BY_ID.get(id) ?? null) : null;
}

export function backgroundById(id: string | null | undefined): BackgroundStyle | null {
  return id ? (BACKGROUNDS_BY_ID.get(id) ?? null) : null;
}
