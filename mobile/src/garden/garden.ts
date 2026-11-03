import { supabase } from '../lib/supabase';

// The garden (0162_garden.sql): 3 plots in the Yard that grow with your
// steps. Types, the server calls, and how far along a plant is.

export type GardenSeason = 'autumn' | 'winter' | 'spring' | 'summer';

export interface SeedKind {
  id: string;
  name: string;
  // Steps after planting to bloom.
  steps: number;
  packBones: number;
  packSize: number;
  // Can be the week's free seed.
  free: boolean;
  season: GardenSeason | null;
  onSale: boolean;
}

export interface GardenPlot {
  plot: number;
  seedId: string;
  plantedOn: string;
  steps: number;
  need: number;
  bloomed: boolean;
}

export interface Garden {
  // Index 0 to 2; null is an empty plot.
  plots: (GardenPlot | null)[];
  seeds: Map<string, number>;
  kinds: SeedKind[];
  freeSeed: boolean;
  picked: Map<string, number>;
  balance: number | null;
}

export const PLOTS = 3;

// 0 seed, 1 sprout, 2 growing, 3 bloomed.
export type PlantStage = 0 | 1 | 2 | 3;

export function plantStage(p: Pick<GardenPlot, 'steps' | 'need' | 'bloomed'>): PlantStage {
  if (p.bloomed || p.steps >= p.need) return 3;
  const f = p.need > 0 ? p.steps / p.need : 0;
  if (f < 0.2) return 0;
  if (f < 0.6) return 1;
  return 2;
}

export function plantProgress(p: Pick<GardenPlot, 'steps' | 'need'>): number {
  return p.need > 0 ? Math.max(0, Math.min(1, p.steps / p.need)) : 0;
}

export const STAGE_NAMES = ['Just planted', 'Sprouting', 'Nearly there', 'Bloomed'] as const;

function parse(d: any): Garden {
  const plots: (GardenPlot | null)[] = Array.from({ length: PLOTS }, () => null);
  for (const p of (d?.plots ?? []) as any[]) {
    const i = Number(p.plot);
    if (i >= 0 && i < PLOTS) {
      plots[i] = {
        plot: i,
        seedId: p.seed_id,
        plantedOn: p.planted_on,
        steps: Number(p.steps ?? 0),
        need: Number(p.need ?? 1),
        bloomed: !!p.bloomed_at,
      };
    }
  }
  const seeds = new Map<string, number>();
  for (const s of (d?.seeds ?? []) as any[]) seeds.set(s.id, Number(s.count ?? 0));
  const picked = new Map<string, number>();
  for (const s of (d?.picked ?? []) as any[]) picked.set(s.id, Number(s.count ?? 0));
  const kinds: SeedKind[] = ((d?.kinds ?? []) as any[]).map((k) => ({
    id: k.id,
    name: k.name,
    steps: Number(k.steps ?? 0),
    packBones: Number(k.pack_bones ?? 0),
    packSize: Number(k.pack_size ?? 1),
    free: !!k.free,
    season: k.season ?? null,
    onSale: k.on_sale !== false,
  }));
  return { plots, seeds, kinds, freeSeed: !!d?.free_seed, picked, balance: d?.balance == null ? null : Number(d.balance) };
}

async function call(fn: string, args: Record<string, unknown>): Promise<Garden> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return parse(data);
}

export const getGarden = (day: string) => call('my_garden', { p_day: day });
export const claimFreeSeed = (day: string, seed: string) => call('claim_free_seed', { p_day: day, p_seed: seed });
export const buySeedPack = (day: string, seed: string) => call('buy_seed_pack', { p_day: day, p_seed: seed });
export const plantSeed = (day: string, plot: number, seed: string) => call('plant_seed', { p_day: day, p_plot: plot, p_seed: seed });
export const pickPlant = (day: string, plot: number) => call('pick_plant', { p_day: day, p_plot: plot });
export const digUpPlant = (day: string, plot: number) => call('dig_up_plant', { p_day: day, p_plot: plot });

// Admin → Garden (0162).
export interface GardenOverview {
  gardenersEver: number;
  growingNow: number;
  planted7d: number;
  bloomed7d: number;
  bloomedEver: number;
  pickedEver: number;
  dugUpEver: number;
  freeSeeds7d: number;
  packs7d: number;
  packBuyersEver: number;
  bones7d: number;
  bonesEver: number;
  bySeed: { id: string; name: string; planted: number; bloomed: number; packs: number }[];
}

export async function getGardenOverview(): Promise<GardenOverview> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { data, error } = await supabase.rpc('admin_garden_overview');
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as any;
  const n = (v: unknown) => Number(v ?? 0);
  return {
    gardenersEver: n(d.gardeners_ever),
    growingNow: n(d.growing_now),
    planted7d: n(d.planted_7d),
    bloomed7d: n(d.bloomed_7d),
    bloomedEver: n(d.bloomed_ever),
    pickedEver: n(d.picked_ever),
    dugUpEver: n(d.dug_up_ever),
    freeSeeds7d: n(d.free_seeds_7d),
    packs7d: n(d.packs_7d),
    packBuyersEver: n(d.pack_buyers_ever),
    bones7d: n(d.bones_7d),
    bonesEver: n(d.bones_ever),
    bySeed: ((d.by_seed ?? []) as any[]).map((s) => ({ id: s.id, name: s.name, planted: n(s.planted), bloomed: n(s.bloomed), packs: n(s.packs) })),
  };
}
