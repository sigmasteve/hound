// Kennel accessories. Mirrors 0104_kennel.sql's kennel_items rows by
// hand (ids, slot, name, price); buy_kennel_item is the real price check.
// How each one looks lives only here (HoundArt draws them).

export type KennelSlot = 'neck' | 'head' | 'face' | 'coat' | 'breed';

export type KennelItemKind =
  | 'collar'
  | 'bandana'
  | 'beanie'
  | 'party'
  | 'crown'
  | 'pumpkin'
  | 'witch'
  | 'round'
  | 'sun'
  | 'mask'
  | 'coat'
  | 'breed';

export interface KennelItem {
  id: string;
  slot: KennelSlot;
  name: string;
  costBones: number;
  kind: KennelItemKind;
  color: string;
  // A second color where the drawing needs one (a bandana's dots).
  accent?: string;
  // Limited-time items (0112_halloween_kennel.sql): the season's name and
  // the last day it can be bought, YYYY-MM-DD. Owned ones stay for good.
  season?: string;
  availableUntil?: string;
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
  // Coats (0105_kennel_friends_coats.sql): color is the swatch; COATS below
  // has the full set. 0 Bones means free to pick.
  { id: 'coat_chocolate', slot: 'coat', name: 'Chocolate', costBones: 0, kind: 'coat', color: '#7b4a2a' },
  { id: 'coat_cream', slot: 'coat', name: 'Cream', costBones: 0, kind: 'coat', color: '#ead2a8' },
  { id: 'coat_gray', slot: 'coat', name: 'Gray', costBones: 0, kind: 'coat', color: '#9aa0ab' },
  { id: 'coat_black_tan', slot: 'coat', name: 'Black & Tan', costBones: 60, kind: 'coat', color: '#2f2a28' },
  { id: 'coat_golden', slot: 'coat', name: 'Golden', costBones: 100, kind: 'coat', color: '#e3a83b' },
  { id: 'coat_midnight', slot: 'coat', name: 'Midnight Blue', costBones: 150, kind: 'coat', color: '#3b3f8f' },
  { id: 'coat_candy', slot: 'coat', name: 'Cotton Candy', costBones: 150, kind: 'coat', color: '#f2a7c3' },
  // Breeds (0132_kennel_breeds.sql): a different dog altogether, drawn by
  // HoundArt. color is the natural coat, used when no coat item is on.
  { id: 'breed_corgi', slot: 'breed', name: 'Corgi', costBones: 600, kind: 'breed', color: '#d9823a' },
  { id: 'breed_poodle', slot: 'breed', name: 'Poodle', costBones: 600, kind: 'breed', color: '#e9c9a4' },
  { id: 'breed_frenchie', slot: 'breed', name: 'French Bulldog', costBones: 600, kind: 'breed', color: '#c4a07a' },
  // Halloween 2026, through October 31.
  ...(
    [
      { id: 'hat_pumpkin', slot: 'head', name: 'Pumpkin Hat', costBones: 80, kind: 'pumpkin', color: '#f08a24' },
      { id: 'hat_witch', slot: 'head', name: 'Witch Hat', costBones: 120, kind: 'witch', color: '#3b2a5c', accent: '#f08a24' },
      { id: 'bandana_spooky', slot: 'neck', name: 'Spooky Bandana', costBones: 60, kind: 'bandana', color: '#f08a24', accent: '#2b1d14' },
      { id: 'mask_masquerade', slot: 'face', name: 'Masquerade Mask', costBones: 100, kind: 'mask', color: '#2b1d3a', accent: '#e0b84f' },
      { id: 'coat_pumpkin', slot: 'coat', name: 'Pumpkin Spice', costBones: 120, kind: 'coat', color: '#e07b2a' },
    ] as const
  ).map((i) => ({ ...i, season: 'Halloween', availableUntil: '2026-10-31' })),
];

// Whether it can be bought on this day (YYYY-MM-DD, the member's own).
export function onSale(item: KennelItem, dayKey: string): boolean {
  return !item.availableUntil || dayKey <= item.availableUntil;
}

// "Until Oct 31", for a limited-time item.
export function saleEndsLabel(item: KennelItem): string | null {
  if (!item.availableUntil) return null;
  const [y, m, d] = item.availableUntil.split('-').map(Number);
  return `Until ${new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

export interface CoatColors {
  coat: string;
  // Ears, haunches and markings.
  dark: string;
  // Muzzle, chest and paws.
  light: string;
  // Light spots over the eyes, so they show on a dark coat.
  eyeSpots?: boolean;
}

// Tan is the default: no coat item.
const TAN: CoatColors = { coat: '#c98a4b', dark: '#7a4a24', light: '#f1d7b0' };

const COATS: Record<string, CoatColors> = {
  coat_chocolate: { coat: '#7b4a2a', dark: '#4a2a16', light: '#d9b38c' },
  coat_cream: { coat: '#ead2a8', dark: '#c79a62', light: '#fbf1df' },
  coat_gray: { coat: '#9aa0ab', dark: '#5f6470', light: '#e4e6ea' },
  coat_black_tan: { coat: '#2f2a28', dark: '#1a1716', light: '#c98a4b', eyeSpots: true },
  coat_golden: { coat: '#e3a83b', dark: '#b5741c', light: '#fbe3a6' },
  coat_midnight: { coat: '#3b3f8f', dark: '#24275c', light: '#a9b1f0', eyeSpots: true },
  coat_candy: { coat: '#f2a7c3', dark: '#c96b92', light: '#fde3ee' },
  coat_pumpkin: { coat: '#e07b2a', dark: '#8a3f12', light: '#fbd9a8' },
};

export function coatColors(coatId: string | null | undefined): CoatColors {
  return (coatId && COATS[coatId]) || TAN;
}

export const TAN_SWATCH = TAN.coat;

// ── Breeds ───────────────────────────────────────────────────────────

export type HoundBreed = 'corgi' | 'poodle' | 'frenchie';

const BREED_BY_ITEM: Record<string, HoundBreed> = {
  breed_corgi: 'corgi',
  breed_poodle: 'poodle',
  breed_frenchie: 'frenchie',
};

export function breedForItem(breedId: string | null | undefined): HoundBreed | null {
  return (breedId && BREED_BY_ITEM[breedId]) || null;
}

// Each breed's own coat, when no coat item is on. A coat item recolours
// a breed the same way it does the hound.
const BREED_COATS: Record<HoundBreed, CoatColors> = {
  corgi: { coat: '#d9823a', dark: '#a0521c', light: '#fbf1df' },
  poodle: { coat: '#e9c9a4', dark: '#c79a62', light: '#fbf1df' },
  frenchie: { coat: '#c4a07a', dark: '#4a3a30', light: '#efe0cc' },
};

export function breedCoatColors(breed: HoundBreed | null, coatId: string | null | undefined): CoatColors {
  if (coatId && COATS[coatId]) return COATS[coatId];
  return breed ? BREED_COATS[breed] : TAN;
}

// Free looks (set_kennel_look), mirrored by kennels' own checks.
export type HoundEars = 'floppy' | 'perky' | 'short';
export type HoundTail = 'wavy' | 'curly' | 'stubby';
export type HoundMarkings = 'none' | 'eye_patch' | 'spots';

export const EAR_OPTIONS: { id: HoundEars; name: string }[] = [
  { id: 'floppy', name: 'Floppy' },
  { id: 'perky', name: 'Perky' },
  { id: 'short', name: 'Short' },
];
export const TAIL_OPTIONS: { id: HoundTail; name: string }[] = [
  { id: 'wavy', name: 'Wavy' },
  { id: 'curly', name: 'Curly' },
  { id: 'stubby', name: 'Stubby' },
];
export const MARKING_OPTIONS: { id: HoundMarkings; name: string }[] = [
  { id: 'none', name: 'None' },
  { id: 'eye_patch', name: 'Eye patch' },
  { id: 'spots', name: 'Spots' },
];

const BY_ID = new Map(KENNEL_ITEMS.map((i) => [i.id, i] as const));

// Null for no id, or an id this build doesn't know yet.
export function kennelItemById(id: string | null | undefined): KennelItem | null {
  return id ? (BY_ID.get(id) ?? null) : null;
}

export const KENNEL_SLOTS: { slot: KennelSlot; label: string }[] = [
  { slot: 'neck', label: 'Collars & bandanas' },
  { slot: 'head', label: 'Hats' },
  { slot: 'face', label: 'Glasses & masks' },
];

// What a treat (or, in classic care, a meal) costs. give_treat's own
// price is the real one.
export const TREAT_BONES = 10;
