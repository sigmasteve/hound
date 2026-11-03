// Water (0153_water.sql): a daily goal in millilitres, shown in cups or
// millilitres, logged a glass at a time. Pure helpers; the state lives in
// WaterContext.

export type WaterUnits = 'cups' | 'ml';

export interface WaterGoal {
  targetMl: number;
  glassMl: number;
  units: WaterUnits;
  sipReminders: boolean;
}

export interface WaterEntry {
  id: string;
  // Local day, 'YYYY-MM-DD'.
  day: string;
  ml: number;
  at: Date;
}

// One US cup.
export const CUP_ML = 236.588;
// 75 Day's water item: a gallon.
export const GALLON_ML = 3785;

export const DEFAULT_WATER_GOAL: WaterGoal = {
  targetMl: Math.round(8 * CUP_ML),
  glassMl: Math.round(CUP_ML),
  units: 'cups',
  sipReminders: false,
};

export interface GlassSize {
  id: string;
  name: string;
  ml: number;
}

// The glass-size chips. Cups and US bottles for cups; round sizes for ml.
export function glassSizes(units: WaterUnits): GlassSize[] {
  return units === 'cups'
    ? [
        { id: 'cup', name: 'Cup', ml: Math.round(CUP_ML) },
        { id: 'bottle', name: 'Bottle', ml: 500 },
        { id: 'big', name: 'Big bottle', ml: 710 },
      ]
    : [
        { id: 'glass', name: 'Glass', ml: 250 },
        { id: 'bottle', name: 'Bottle', ml: 500 },
        { id: 'big', name: 'Big bottle', ml: 750 },
      ];
}

// What a glass of this size is called, for "Add a cup".
export function glassName(ml: number, units: WaterUnits): string {
  const match = glassSizes(units).find((g) => Math.abs(g.ml - ml) < 3);
  return match ? match.name.toLowerCase() : 'glass';
}

export function mlToOz(ml: number): number {
  return ml / 29.5735;
}

function trim(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

// "5", "5.5": cups to the nearest tenth, whole when it is.
export function cupsText(ml: number): string {
  return trim(ml / CUP_ML);
}

// "8 cups", "2,000 ml".
export function amountText(ml: number, units: WaterUnits): string {
  if (units === 'ml') return `${Math.round(ml).toLocaleString()} ml`;
  const c = cupsText(ml);
  return `${c} ${c === '1' ? 'cup' : 'cups'}`;
}

// The number alone, for "5 of 8 cups".
export function amountNumber(ml: number, units: WaterUnits): string {
  return units === 'ml' ? Math.round(ml).toLocaleString() : cupsText(ml);
}

export function unitWord(units: WaterUnits): string {
  return units === 'ml' ? 'ml' : 'cups';
}

// "5 of 8 cups".
export function progressText(ml: number, goal: WaterGoal): string {
  return `${amountNumber(ml, goal.units)} of ${amountText(goal.targetMl, goal.units)}`;
}

// The second line under it: "40 of 64 oz" for cups, "1.2 of 2 L" for ml.
export function detailText(ml: number, goal: WaterGoal): string {
  if (goal.units === 'ml') return `${trim(ml / 1000)} of ${trim(goal.targetMl / 1000)} L`;
  return `${Math.round(mlToOz(ml))} of ${Math.round(mlToOz(goal.targetMl))} oz`;
}

// "1 cup", "16.9 oz bottle", "500 ml".
export function entryText(ml: number, units: WaterUnits): string {
  if (units === 'ml') return `${Math.round(ml)} ml`;
  if (Math.abs(ml - CUP_ML) < 3) return '1 cup';
  return `${trim(mlToOz(ml))} oz`;
}

// A glass size on its chip: "8 oz", "16.9 oz", "500 ml".
export function sizeText(ml: number, units: WaterUnits): string {
  return units === 'ml' ? `${Math.round(ml)} ml` : `${trim(mlToOz(ml))} oz`;
}

// The goal's own steps: whole cups from 4 to 16, or 250 ml from 1 to 4 L.
export const TARGET_STEPS = {
  cups: { min: 4, max: 16, step: 1 },
  ml: { min: 1000, max: 4000, step: 250 },
} as const;

export function targetInUnits(goal: Pick<WaterGoal, 'targetMl' | 'units'>): number {
  return goal.units === 'ml' ? Math.round(goal.targetMl / 250) * 250 : Math.round(goal.targetMl / CUP_ML);
}

export function targetMlFor(value: number, units: WaterUnits): number {
  return units === 'ml' ? value : Math.round(value * CUP_ML);
}

// The same goal, switched to the other units: 8 cups becomes 2,000 ml.
export function switchUnits(goal: WaterGoal, units: WaterUnits): WaterGoal {
  if (goal.units === units) return goal;
  const { min, max, step } = TARGET_STEPS[units];
  const value = units === 'ml' ? Math.round(goal.targetMl / step) * step : Math.round(goal.targetMl / CUP_ML);
  const target = Math.min(max, Math.max(min, value));
  const sizes = glassSizes(units);
  const glass = sizes.reduce((best, g) => (Math.abs(g.ml - goal.glassMl) < Math.abs(best.ml - goal.glassMl) ? g : best), sizes[0]);
  return { ...goal, units, targetMl: targetMlFor(target, units), glassMl: glass.ml };
}

export function localDayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dayKeyBefore(days: number, from: Date = new Date()): string {
  return localDayKey(new Date(from.getFullYear(), from.getMonth(), from.getDate() - days));
}
