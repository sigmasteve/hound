import { supabase } from '../lib/supabase';
import type { FindRarity } from '../walks/walks';

// Bath day and homemade treats (0169, lifestyle phase 4).
//
// Bath day is only the happy side: a long walk today (30 minutes or
// 3,000 steps) brings the hound home muddy, and a good active day (that
// walk, 6,000 steps, your goals done, or a Bones pack bought today) earns
// a bath, once a day. Since 0177 the bath is a game you play (BathScene):
// popped bubbles pay Bones, capped by the server. Treats are baked from spare walk finds plus Bones, then fed as
// today's treat or sent to a friend's hound.

export type BathEarned = 'walk' | 'steps' | 'goal' | 'pack';

export interface BathState {
  bathed: boolean;
  bathedAt: string | null;
  muddy: boolean;
  // What earned today's bath, or null before it's been earned.
  earned: BathEarned | null;
  canBath: boolean;
  walkSteps: number | null;
  walkMinutes: number | null;
  // Today's bath (0177): played or quick, and the Bones it paid.
  bathKind: 'play' | 'quick' | null;
  bathBones: number;
  // The bath game's settings (0177): bubbles a bath, and the golden one.
  bubbles: number;
  goldenBones: number;
}

export interface TreatRecipe {
  id: string;
  name: string;
  common: number;
  uncommon: number;
  rare: number;
  bones: number;
}

export interface PantryTreat {
  id: string;
  recipeId: string;
  // A friend's name when it was a gift to you, with their note.
  from: string | null;
  note: string | null;
  madeAt: string;
}

export interface Care {
  bath: BathState;
  recipes: TreatRecipe[];
  // Spare finds by kind: found, and not yet baked.
  spare: { id: string; rarity: FindRarity; n: number }[];
  pantry: PantryTreat[];
  treatedToday: boolean;
  made: number;
}

// What the kitchen draws, and a line about each (0169's treat_recipes).
export const RECIPE_NOTES: Record<string, string> = {
  pumpkin_biscuits: 'Crunchy, bone-shaped, a little orange.',
  pb_pupcake: 'A peanut butter cupcake with a bone on top.',
  frosty_paws: 'A cup of frozen yogurt for a warm day.',
  birthday_cake: 'For a birthday, or any day worth one.',
};

export function spareOf(care: Pick<Care, 'spare'>, rarity: FindRarity): number {
  return care.spare.filter((s) => s.rarity === rarity).reduce((n, s) => n + s.n, 0);
}

// The finds a recipe still needs, by rarity, or null when you have them.
export function missingFinds(care: Pick<Care, 'spare'>, r: TreatRecipe): string | null {
  const short: string[] = [];
  for (const tier of ['common', 'uncommon', 'rare'] as const) {
    const gap = r[tier] - spareOf(care, tier);
    if (gap > 0) short.push(`${gap} more ${tier}`);
  }
  return short.length ? short.join(', ') : null;
}

// "2 common", "1 common + 1 uncommon"
export function recipeNeeds(r: TreatRecipe): string {
  return (['common', 'uncommon', 'rare'] as const)
    .filter((t) => r[t] > 0)
    .map((t) => `${r[t]} ${t}`)
    .join(' + ');
}

export function bathLine(b: BathState, houndName: string): string {
  if (b.bathed && !b.muddy) {
    return b.bathKind === 'play' && b.bathBones > 0
      ? `${houndName} had a bath today: fresh, fluffy and ${b.bathBones} Bones from the bubbles.`
      : `${houndName} had a bath today. Fresh and fluffy.`;
  }
  if (b.muddy) {
    const walk = b.walkMinutes ? `${b.walkMinutes} minutes out` : 'A long walk';
    return `${walk}, and ${houndName} came home muddy. ${b.bathed ? 'One bath a day: tomorrow, then.' : 'Bath time!'}`;
  }
  if (b.canBath) {
    return b.earned === 'goal'
      ? `Goals done today: ${houndName} has earned a bath.`
      : b.earned === 'pack'
        ? `Thanks for the Bones! ${houndName} has earned a bath.`
        : `A busy day: ${houndName} has earned a bath.`;
  }
  return `One bath a day, earned by a long walk (30 minutes), 6,000 steps, your goals done or a Bones pack.`;
}

function parse(data: unknown): Care {
  const d = (data ?? {}) as any;
  const b = d.bath ?? {};
  return {
    bath: {
      bathed: !!b.bathed,
      bathedAt: b.bathed_at ?? null,
      muddy: !!b.muddy,
      earned: (b.earned ?? null) as BathEarned | null,
      canBath: !!b.can_bath,
      walkSteps: b.walk_steps == null ? null : Number(b.walk_steps),
      walkMinutes: b.walk_minutes == null ? null : Number(b.walk_minutes),
      bathKind: (b.bath_kind ?? null) as 'play' | 'quick' | null,
      bathBones: Number(b.bath_bones ?? 0),
      bubbles: b.bubbles == null ? 10 : Number(b.bubbles),
      goldenBones: b.golden_bones == null ? 5 : Number(b.golden_bones),
    },
    recipes: ((d.recipes ?? []) as any[]).map((r) => ({
      id: r.id,
      name: r.name,
      common: Number(r.common ?? 0),
      uncommon: Number(r.uncommon ?? 0),
      rare: Number(r.rare ?? 0),
      bones: Number(r.bones ?? 0),
    })),
    spare: ((d.spare ?? []) as any[]).map((s) => ({ id: s.id, rarity: s.rarity, n: Number(s.n ?? 0) })),
    pantry: ((d.pantry ?? []) as any[]).map((t) => ({
      id: t.id,
      recipeId: t.recipe_id,
      from: t.from ?? null,
      note: t.note ?? null,
      madeAt: t.made_at,
    })),
    treatedToday: !!d.treated_today,
    made: Number(d.made ?? 0),
  };
}

async function call(fn: string, args: Record<string, unknown>): Promise<Care> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return parse(data);
}

export const getCare = (day: string) => call('my_care', { p_day: day });
export const giveBath = (day: string) => call('give_bath', { p_day: day });
export const finishBath = (day: string, bubbles: number, golden: boolean) =>
  call('finish_bath', { p_day: day, p_bubbles: bubbles, p_golden: golden });
export const makeTreat = (day: string, recipe: string) => call('make_treat', { p_day: day, p_recipe: recipe });
export const feedTreat = (day: string, treat: string) => call('feed_homemade_treat', { p_day: day, p_treat: treat });
export const giftTreat = (day: string, friend: string, treat: string, note: string | null) =>
  call('gift_treat', { p_friend: friend, p_treat: treat, p_note: note, p_day: day });

// Admin → Bath and treats (0169).
export interface CareOverview {
  baths7d: number;
  bathers7d: number;
  bathsAll: number;
  bathersAll: number;
  made7d: number;
  bakers7d: number;
  madeAll: number;
  bakersAll: number;
  fed7d: number;
  gifted7d: number;
  giftedAll: number;
  bones7d: number;
  byRecipe: { id: string; name: string; made: number }[];
}

export async function getCareOverview(): Promise<CareOverview> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { data, error } = await supabase.rpc('admin_care_overview');
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as any;
  const n = (v: unknown) => Number(v ?? 0);
  return {
    baths7d: n(d.baths_7d),
    bathers7d: n(d.bathers_7d),
    bathsAll: n(d.baths_all),
    bathersAll: n(d.bathers_all),
    made7d: n(d.made_7d),
    bakers7d: n(d.bakers_7d),
    madeAll: n(d.made_all),
    bakersAll: n(d.bakers_all),
    fed7d: n(d.fed_7d),
    gifted7d: n(d.gifted_7d),
    giftedAll: n(d.gifted_all),
    bones7d: n(d.bones_7d),
    byRecipe: ((d.by_recipe ?? []) as any[]).map((r) => ({ id: r.id, name: r.name, made: n(r.made) })),
  };
}

// Admin → Inside the house (0169).
export interface RoomOverview {
  rooms: number;
  rooms7d: number;
  fullRooms: number;
  placed: number;
  bonesAll: number;
  bones7d: number;
  gifted: number;
  byItem: { id: string; name: string; owned: number }[];
}

export async function getRoomOverview(): Promise<RoomOverview> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { data, error } = await supabase.rpc('admin_room_overview');
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as any;
  const n = (v: unknown) => Number(v ?? 0);
  return {
    rooms: n(d.rooms),
    rooms7d: n(d.rooms_7d),
    fullRooms: n(d.full_rooms),
    placed: n(d.placed),
    bonesAll: n(d.bones_all),
    bones7d: n(d.bones_7d),
    gifted: n(d.gifted),
    byItem: ((d.by_item ?? []) as any[]).map((r) => ({ id: r.id, name: r.name, owned: n(r.owned) })),
  };
}

// Admin → Bath time (0177): who plays the bath, how, and the settings.
export interface BathOverview {
  bubbles: number;
  goldenBones: number;
  played7d: number;
  players7d: number;
  quick7d: number;
  bubbles7d: number;
  golden7d: number;
  bones7d: number;
  allBubbles7d: number;
  playedAll: number;
  playersAll: number;
  bonesAll: number;
  byEarned7d: Partial<Record<BathEarned, number>>;
}

export async function getBathOverview(): Promise<BathOverview> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { data, error } = await supabase.rpc('admin_bath_overview');
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as any;
  const n = (v: unknown) => Number(v ?? 0);
  const by: Partial<Record<BathEarned, number>> = {};
  for (const [k, v] of Object.entries(d.by_earned_7d ?? {})) by[k as BathEarned] = n(v);
  return {
    bubbles: n(d.bubbles),
    goldenBones: n(d.golden_bones),
    played7d: n(d.played_7d),
    players7d: n(d.players_7d),
    quick7d: n(d.quick_7d),
    bubbles7d: n(d.bubbles_7d),
    golden7d: n(d.golden_7d),
    bones7d: n(d.bones_7d),
    allBubbles7d: n(d.all_bubbles_7d),
    playedAll: n(d.played_all),
    playersAll: n(d.players_all),
    bonesAll: n(d.bones_all),
    byEarned7d: by,
  };
}

export async function saveBathSettings(bubbles: number, goldenBones: number): Promise<void> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { error } = await supabase
    .from('bath_settings')
    .update({ bubbles, golden_bones: goldenBones, updated_at: new Date().toISOString() })
    .eq('id', true);
  if (error) throw new Error(error.message);
}
