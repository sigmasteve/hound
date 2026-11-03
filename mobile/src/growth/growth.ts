import { supabase } from '../lib/supabase';

// The Hound grows with you (0164_hound_growth.sql): fitness from active
// days, traits from habits, age from steps since it was born, and a
// birthday.

export type HoundStage = 'puppy' | 'young' | 'grown';

export interface PartyGuest {
  userId: string;
  owner: string;
  name: string;
  xpTotal: number;
  neckId: string | null;
  headId: string | null;
  faceId: string | null;
  coatId: string | null;
  ears: string | null;
  tail: string | null;
  markings: string | null;
  breedId: string | null;
  bodyId: string | null;
  feetId: string | null;
}

export interface HoundProfile {
  name: string;
  activeDays: number;
  // 1 to 10.
  fitness: number;
  // Active days where this level started, and where the next one does
  // (null at 10).
  fitnessFrom: number;
  fitnessNext: number | null;
  stage: HoundStage;
  // Yours only.
  stepsSinceBorn: number | null;
  bornOn: string | null;
  // 'YYYY-MM-DD'; only the month and day matter.
  birthday: string | null;
  birthdaySetOn: string | null;
  isBirthday: boolean;
  traits: { id: string; earnedAt: Date }[];
  // Yours, on the birthday: a friend's hound over for the party.
  partyGuest: PartyGuest | null;
}

export interface TraitInfo {
  id: string;
  name: string;
  // How it's earned.
  how: string;
}

// The same nine as 0164's hound_trait_check.
export const TRAITS: TraitInfo[] = [
  { id: 'early_bird', name: 'Early bird', how: '8 walks before 8am in a month' },
  { id: 'night_owl', name: 'Night owl', how: '8 walks after 7pm in a month' },
  { id: 'lunch_stroller', name: 'Lunch stroller', how: '8 lunchtime walks in a month' },
  { id: 'trail_dog', name: 'Trail dog', how: '3 walks of 3 miles or more in a month' },
  { id: 'well_watered', name: 'Well watered', how: 'Your water goal on 15 days in a month' },
  { id: 'weekend_warrior', name: 'Weekend warrior', how: '4 weekend days of 10,000 steps in a month' },
  { id: 'steady_paws', name: 'Steady paws', how: '20 days of 5,000 steps in a month' },
  { id: 'collector', name: 'Collector', how: '15 kinds of walk find' },
  { id: 'green_paws', name: 'Green paws', how: '5 plants grown in the garden' },
];

export function traitInfo(id: string): TraitInfo {
  return TRAITS.find((t) => t.id === id) ?? { id, name: id, how: '' };
}

export const STAGE_NAMES: Record<HoundStage, string> = { puppy: 'Puppy', young: 'Young', grown: 'Grown' };

// How big the hound is drawn in the yard.
export const STAGE_SCALE: Record<HoundStage, number> = { puppy: 0.8, young: 0.9, grown: 1 };

// Steps since it was born for the next stage.
export const STAGE_NEXT: Record<HoundStage, number | null> = { puppy: 100000, young: 400000, grown: null };

// "3 weeks old", "5 months old"
export function ageText(bornOn: string | null, today: string): string | null {
  if (!bornOn) return null;
  const days = Math.max(0, Math.round((Date.parse(`${today}T12:00:00`) - Date.parse(`${bornOn}T12:00:00`)) / 86_400_000));
  if (days < 1) return 'Born today';
  if (days < 14) return `${days} ${days === 1 ? 'day' : 'days'} old`;
  if (days < 61) return `${Math.floor(days / 7)} weeks old`;
  if (days < 730) return `${Math.floor(days / 30.44)} months old`;
  return `${Math.floor(days / 365.25)} years old`;
}

// "14 November"
export function birthdayText(birthday: string | null): string | null {
  if (!birthday) return null;
  return new Date(`${birthday}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
}

function parse(d: any): HoundProfile {
  const g = d?.party_guest;
  return {
    name: d?.name ?? 'Scout',
    activeDays: Number(d?.active_days ?? 0),
    fitness: Number(d?.fitness ?? 1),
    fitnessFrom: Number(d?.fitness_from ?? 0),
    fitnessNext: d?.fitness_next == null ? null : Number(d.fitness_next),
    stage: (d?.stage ?? 'grown') as HoundStage,
    stepsSinceBorn: d?.steps_since_born == null ? null : Number(d.steps_since_born),
    bornOn: d?.born_on ?? null,
    birthday: d?.birthday ?? null,
    birthdaySetOn: d?.birthday_set_on ?? null,
    isBirthday: !!d?.is_birthday,
    traits: ((d?.traits ?? []) as any[]).map((t) => ({ id: t.id, earnedAt: new Date(t.earned_at) })),
    partyGuest: g
      ? {
          userId: g.user_id,
          owner: g.owner ?? '',
          name: g.name ?? 'A friend',
          xpTotal: Number(g.xp_total ?? 0),
          neckId: g.neck_id ?? null,
          headId: g.head_id ?? null,
          faceId: g.face_id ?? null,
          coatId: g.coat_id ?? null,
          ears: g.ears ?? null,
          tail: g.tail ?? null,
          markings: g.markings ?? null,
          breedId: g.breed_id ?? null,
          bodyId: g.body_id ?? null,
          feetId: g.feet_id ?? null,
        }
      : null,
  };
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<any> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

export const getMyHoundProfile = async (day: string) => parse(await rpc('my_hound_profile', { p_day: day }));
export const getFriendHoundProfile = async (friend: string, day: string) =>
  parse(await rpc('friend_hound_profile', { p_friend: friend, p_day: day }));
export const setHoundBirthday = async (day: string, birthday: string) =>
  parse(await rpc('set_hound_birthday', { p_day: day, p_birthday: birthday }));

// Admin → Growth (0164).
export interface GrowthOverview {
  hounds: number;
  byFitness: { level: number; count: number }[];
  byStage: Record<HoundStage, number>;
  withTrait: number;
  traits7d: number;
  byTrait: { id: string; count: number }[];
  birthdaysSet: number;
  birthdaysToday: number;
}

export async function getGrowthOverview(): Promise<GrowthOverview> {
  const d = (await rpc('admin_growth_overview', {})) ?? {};
  const n = (v: unknown) => Number(v ?? 0);
  return {
    hounds: n(d.hounds),
    byFitness: ((d.by_fitness ?? []) as any[]).map((x) => ({ level: n(x.level), count: n(x.count) })),
    byStage: { puppy: n(d.by_stage?.puppy), young: n(d.by_stage?.young), grown: n(d.by_stage?.grown) },
    withTrait: n(d.with_trait),
    traits7d: n(d.traits_7d),
    byTrait: ((d.by_trait ?? []) as any[]).map((x) => ({ id: x.id, count: n(x.count) })),
    birthdaysSet: n(d.birthdays_set),
    birthdaysToday: n(d.birthdays_today),
  };
}
