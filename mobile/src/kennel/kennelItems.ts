// Kennel accessories. Mirrors 0104_kennel.sql's kennel_items rows by
// hand (ids, slot, name, price); buy_kennel_item is the real price check.
// How each one looks lives only here (HoundArt draws them).

// body and feet: clothes (0156_shop_phase1.sql).
export type KennelSlot = 'neck' | 'head' | 'face' | 'coat' | 'breed' | 'body' | 'feet';

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
  | 'breed'
  | 'pilgrim'
  | 'turkey'
  | 'santa'
  | 'antlers'
  | 'sweater'
  | 'hoodie'
  | 'raincoat'
  | 'puffer'
  | 'tutu'
  | 'cape'
  | 'tux'
  | 'trench'
  | 'booties'
  | 'sneakers'
  | 'rainboots';

export interface KennelItem {
  id: string;
  slot: KennelSlot;
  name: string;
  costBones: number;
  kind: KennelItemKind;
  color: string;
  // A second color where the drawing needs one (a bandana's dots).
  accent?: string;
  // Limited-time items (0112_halloween_kennel.sql): the season's name,
  // the first day it's shown and the last day it can be bought,
  // YYYY-MM-DD. Owned ones stay for good.
  season?: string;
  availableFrom?: string;
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
  // Thanksgiving 2026 (0134_thanksgiving.sql), November.
  ...(
    [
      { id: 'hat_pilgrim', slot: 'head', name: 'Pilgrim Hat', costBones: 100, kind: 'pilgrim', color: '#2b2b33', accent: '#e0b84f' },
      { id: 'hat_turkey', slot: 'head', name: 'Turkey Hat', costBones: 120, kind: 'turkey', color: '#8a4a1c', accent: '#e07b2a' },
      { id: 'bandana_harvest', slot: 'neck', name: 'Harvest Bandana', costBones: 60, kind: 'bandana', color: '#8a4a1c', accent: '#e0a94f' },
      { id: 'coat_maple', slot: 'coat', name: 'Maple', costBones: 120, kind: 'coat', color: '#a3402a' },
    ] as const
  ).map((i) => ({ ...i, season: 'Thanksgiving', availableFrom: '2026-11-01', availableUntil: '2026-11-30' })),
  // Clothes (0156_shop_phase1.sql): drawn on every breed by HoundArt.
  { id: 'sweater_red', slot: 'body', name: 'Red Sweater', costBones: 120, kind: 'sweater', color: '#d94a4a', accent: '#f5e6d3' },
  { id: 'sweater_blue', slot: 'body', name: 'Blue Sweater', costBones: 120, kind: 'sweater', color: '#4f7fd0', accent: '#f5e6d3' },
  { id: 'sweater_green', slot: 'body', name: 'Green Sweater', costBones: 120, kind: 'sweater', color: '#3f9a63', accent: '#f5e6d3' },
  { id: 'body_hoodie', slot: 'body', name: 'Hoodie', costBones: 150, kind: 'hoodie', color: '#6f7686', accent: '#e9e9ed' },
  { id: 'body_raincoat', slot: 'body', name: 'Raincoat', costBones: 150, kind: 'raincoat', color: '#f2c430', accent: '#c79a16' },
  { id: 'body_puffer', slot: 'body', name: 'Puffer Vest', costBones: 200, kind: 'puffer', color: '#e8743a', accent: '#b9531f' },
  { id: 'body_tutu', slot: 'body', name: 'Tutu', costBones: 180, kind: 'tutu', color: '#f4a3c8', accent: '#fbd3e6' },
  { id: 'body_cape', slot: 'body', name: 'Superhero Cape', costBones: 300, kind: 'cape', color: '#d12f3f', accent: '#f2c430' },
  { id: 'body_tux', slot: 'body', name: 'Tuxedo', costBones: 400, kind: 'tux', color: '#1f2230', accent: '#ffffff' },
  { id: 'body_trench', slot: 'body', name: 'Designer Trench', costBones: 800, kind: 'trench', color: '#c9a77a', accent: '#8a6a3f' },
  { id: 'booties_red', slot: 'feet', name: 'Red Booties', costBones: 80, kind: 'booties', color: '#d94a4a' },
  { id: 'booties_blue', slot: 'feet', name: 'Blue Booties', costBones: 80, kind: 'booties', color: '#4f7fd0' },
  { id: 'booties_pink', slot: 'feet', name: 'Pink Booties', costBones: 80, kind: 'booties', color: '#f08ab8' },
  { id: 'booties_black', slot: 'feet', name: 'Black Booties', costBones: 80, kind: 'booties', color: '#2b2b33' },
  { id: 'feet_sneakers', slot: 'feet', name: 'Sneakers', costBones: 120, kind: 'sneakers', color: '#ffffff', accent: '#4f7fd0' },
  { id: 'feet_rainboots', slot: 'feet', name: 'Rain Boots', costBones: 120, kind: 'rainboots', color: '#f2c430' },
  { id: 'feet_gold', slot: 'feet', name: 'Gold Sneakers', costBones: 500, kind: 'sneakers', color: '#e0b84f', accent: '#fff3c4' },
  // Winter 2026 (0156), on sale Nov 15 to Dec 31.
  ...(
    [
      { id: 'hat_santa', slot: 'head', name: 'Santa Hat', costBones: 120, kind: 'santa', color: '#d12f3f', accent: '#ffffff' },
      { id: 'hat_antlers', slot: 'head', name: 'Reindeer Antlers', costBones: 100, kind: 'antlers', color: '#8a5a2b', accent: '#d12f3f' },
      { id: 'sweater_holiday', slot: 'body', name: 'Christmas Sweater', costBones: 150, kind: 'sweater', color: '#2f7a4a', accent: '#d12f3f' },
    ] as const
  ).map((i) => ({ ...i, season: 'Winter', availableFrom: '2026-11-15', availableUntil: '2026-12-31' })),
];

// Whether it's for sale on this day (YYYY-MM-DD, the member's own).
export function onSale(item: KennelItem, dayKey: string): boolean {
  return (!item.availableFrom || dayKey >= item.availableFrom) && (!item.availableUntil || dayKey <= item.availableUntil);
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
  coat_maple: { coat: '#a3402a', dark: '#5e2314', light: '#f1cfb0' },
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
  { slot: 'body', label: 'Outfits' },
  { slot: 'feet', label: 'Booties & shoes' },
];

// What a treat (or, in classic care, a meal) costs. give_treat's own
// price is the real one.
export const TREAT_BONES = 10;
