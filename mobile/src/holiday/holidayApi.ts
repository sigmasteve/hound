import { supabase } from '../lib/supabase';
import { HOLIDAY_THEME_IDS, type HolidayThemeId } from './holidays';

// The holiday theme schedule (0184). Everyone reads what's showing on
// their own day; admins schedule runs and see the numbers.

export interface HolidayRun {
  id: number;
  theme: HolidayThemeId;
  startsOn: string;
  endsOn: string;
  // The falling snow / leaves / confetti, for everyone (people can still
  // turn it off for themselves).
  effects: boolean;
}

export interface HolidayRunStats extends HolidayRun {
  seen: number;
  seenToday: number;
  effectsOff: number;
  tappers: number;
  taps: number;
}

export interface HolidayOverview {
  showing: HolidayRun | null;
  active14d: number;
  // To come or on now, soonest first, then those that ended lately.
  runs: HolidayRunStats[];
}

function client() {
  if (!supabase) throw new Error('Not connected to Hound.');
  return supabase;
}

function run(d: any): HolidayRun | null {
  if (!d || !HOLIDAY_THEME_IDS.includes(d.theme)) return null;
  return { id: Number(d.id), theme: d.theme, startsOn: d.starts_on, endsOn: d.ends_on, effects: d.effects !== false };
}

export async function getHolidayTheme(day: string): Promise<HolidayRun | null> {
  const { data, error } = await client().rpc('get_holiday_theme', { p_day: day });
  if (error) throw new Error(error.message);
  return run(data);
}

export async function holidayThemeSeen(theme: HolidayThemeId, day: string, effectsOff: boolean): Promise<void> {
  const { error } = await client().rpc('holiday_theme_seen', { p_theme: theme, p_day: day, p_effects_off: effectsOff });
  if (error) throw new Error(error.message);
}

export async function holidayCountdownTap(theme: HolidayThemeId, day: string): Promise<void> {
  const { error } = await client().rpc('holiday_countdown_tap', { p_theme: theme, p_day: day });
  if (error) throw new Error(error.message);
}

export async function getHolidayOverview(day: string): Promise<HolidayOverview> {
  const { data, error } = await client().rpc('admin_holiday_overview', { p_day: day });
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as any;
  const n = (v: unknown) => Number(v ?? 0);
  return {
    showing: run(d.showing),
    active14d: n(d.active_14d),
    runs: ((d.runs ?? []) as any[])
      .map((r) => {
        const base = run(r);
        return base ? { ...base, seen: n(r.seen), seenToday: n(r.seen_today), effectsOff: n(r.effects_off), tappers: n(r.tappers), taps: n(r.taps) } : null;
      })
      .filter((r): r is HolidayRunStats => !!r),
  };
}

export async function saveHolidayRun(input: { id: number | null; theme: HolidayThemeId; startsOn: string; endsOn: string; effects: boolean }): Promise<number> {
  const { data, error } = await client().rpc('admin_save_holiday_run', {
    p_id: input.id,
    p_theme: input.theme,
    p_starts_on: input.startsOn,
    p_ends_on: input.endsOn,
    p_effects: input.effects,
  });
  if (error) throw new Error(error.message);
  return Number(data);
}

export async function stopHolidayRun(id: number, day: string): Promise<void> {
  const { error } = await client().rpc('admin_stop_holiday_run', { p_id: id, p_day: day });
  if (error) throw new Error(error.message);
}
