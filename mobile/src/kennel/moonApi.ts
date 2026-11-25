import React from 'react';
import { supabase } from '../lib/supabase';
import type { Rank } from '../challenges/ranks';

// Moon forms on the server (0264_moon_forms.sql): your switch for the
// hound's moon look, the scenes you've watched, the one-time catch-up,
// and Admin's numbers.

function client() {
  if (!supabase) throw new Error('Not connected to Hound.');
  return supabase;
}

async function rpc<T = any>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export type MoonRank = Exclude<Rank['id'], 'pup'>;
export type MoonHow = 'rankup' | 'catchup' | 'replay';

export interface MoonState {
  on: boolean;
  level: number;
  reached: MoonRank[];
  watched: MoonRank[];
  catchupDue: boolean;
}

export async function getMoonState(): Promise<MoonState> {
  const d = await rpc<any>('moon_state');
  if (d) myMoonOn = d.on !== false;
  return {
    on: d?.on !== false,
    level: Number(d?.level ?? 0),
    reached: (d?.reached ?? []) as MoonRank[],
    watched: (d?.watched ?? []) as MoonRank[],
    catchupDue: !!d?.catchup_due,
  };
}

export async function setMoonOn(on: boolean): Promise<void> {
  setMyMoonOn(on);
  try {
    await rpc('moon_set', { p_on: on });
  } catch (e) {
    setMyMoonOn(!on);
    throw e;
  }
}

// Never throws: a scene shouldn't fail because the log did.
export function logMoonWatched(rank: MoonRank, how: MoonHow, skipped: boolean): void {
  rpc('moon_watched', { p_rank: rank, p_how: how, p_skipped: skipped }).catch(() => {});
}

export async function moonCatchupSeen(): Promise<void> {
  await rpc('moon_catchup_seen');
}

export async function getMoonFormsOn(userId: string): Promise<boolean> {
  try {
    return (await rpc<boolean>('moon_forms_on', { p_user: userId })) !== false;
  } catch {
    return true;
  }
}

export interface MoonOverview {
  watchers: number;
  watchers7d: number;
  views7d: number;
  skipped7d: number;
  byHow7d: Record<string, number>;
  byRank: Record<string, number>;
  replayers: number;
  catchupOffered: number;
  catchupWatched: number;
  switchedOff: number;
  reached: Record<string, number>;
}

export async function getMoonOverview(): Promise<MoonOverview> {
  const d = await rpc<any>('admin_moon_overview');
  const rec = (x: any): Record<string, number> => Object.fromEntries(Object.entries(x ?? {}).map(([k, v]) => [k, Number(v)]));
  return {
    watchers: Number(d.watchers ?? 0),
    watchers7d: Number(d.watchers_7d ?? 0),
    views7d: Number(d.views_7d ?? 0),
    skipped7d: Number(d.skipped_7d ?? 0),
    byHow7d: rec(d.by_how_7d),
    byRank: rec(d.by_rank),
    replayers: Number(d.replayers ?? 0),
    catchupOffered: Number(d.catchup_offered ?? 0),
    catchupWatched: Number(d.catchup_watched ?? 0),
    switchedOff: Number(d.switched_off ?? 0),
    reached: rec(d.reached),
  };
}

// Your own switch, shared by every screen that draws your hound: a value
// for HoundArt's `moon` (undefined: its rank's look; null: off). Loaded
// once, kept in step by setMyMoonOn.
let myMoonOn: boolean | null = null;
const listeners = new Set<(on: boolean) => void>();

export function setMyMoonOn(on: boolean): void {
  myMoonOn = on;
  listeners.forEach((l) => l(on));
}

export function useMyMoonLook(): null | undefined {
  const [on, setOn] = React.useState<boolean>(myMoonOn ?? true);
  React.useEffect(() => {
    listeners.add(setOn);
    if (myMoonOn === null) {
      getMoonState()
        .then((s) => setMyMoonOn(s.on))
        .catch(() => {});
    }
    return () => {
      listeners.delete(setOn);
    };
  }, []);
  return on ? undefined : null;
}
