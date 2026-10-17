// Kennel accessories. Mirrors 0104_kennel.sql's kennel_items rows by
// hand (ids, slot, name, price); buy_kennel_item is the real price check.
// How each one looks lives only here (HoundArt draws them).

export type KennelSlot = 'neck' | 'head' | 'face';

export type KennelItemKind = 'collar' | 'bandana' | 'beanie' | 'party' | 'crown' | 'round' | 'sun';

export interface KennelItem {
  id: string;
  slot: KennelSlot;
  name: string;
  costBones: number;
  kind: KennelItemKind;
  color: string;
}

export const KENNEL_ITEMS: KennelItem[] = [
  { id: 'collar_red', slot: 'neck', name: 'Red Collar', costBones: 40, kind: 'collar', color: '#d94a4a' },
  { id: 'collar_blue', slot: 'neck', name: 'Blue Collar', costBones: 40, kind: 'collar', color: '#4f8fe0' },
  { id: 'bandana_purple', slot: 'neck', name: 'Purple Bandana', costBones: 60, kind: 'bandana', color: '#8b6fd6' },
  { id: 'bandana_red', slot: 'neck', name: 'Red Bandana', costBones: 60, kind: 'bandana', color: '#d94a4a' },
  { id: 'collar_gold', slot: 'neck', name: 'Gold Collar', costBones: 150, kind: 'collar', color: '#e0b84f' },
  { id: 'hat_beanie', slot: 'head', name: 'Beanie', costBones: 80, kind: 'beanie', color: '#4fbf7a' },
  { id: 'hat_party', slot: 'head', name: 'Party Hat', costBones: 100, kind: 'party', color: '#e04fb0' },
  { id: 'hat_crown', slot: 'head', name: 'Crown', costBones: 300, kind: 'crown', color: '#e0b84f' },
  { id: 'glasses_round', slot: 'face', name: 'Round Glasses', costBones: 90, kind: 'round', color: '#2b2b33' },
  { id: 'glasses_sun', slot: 'face', name: 'Sunglasses', costBones: 120, kind: 'sun', color: '#1b1d29' },
];

const BY_ID = new Map(KENNEL_ITEMS.map((i) => [i.id, i] as const));

// Null for no id, or an id this build doesn't know yet.
export function kennelItemById(id: string | null | undefined): KennelItem | null {
  return id ? (BY_ID.get(id) ?? null) : null;
}

export const KENNEL_SLOTS: { slot: KennelSlot; label: string }[] = [
  { slot: 'neck', label: 'Collars & bandanas' },
  { slot: 'head', label: 'Hats' },
  { slot: 'face', label: 'Glasses' },
];

// What a treat (or, in classic care, a meal) costs. give_treat's own
// price is the real one.
export const TREAT_BONES = 10;
