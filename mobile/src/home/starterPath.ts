import { supabase } from '../lib/supabase';
import { localDayKey } from '../fasting/fasting';

// The starter path, "Your first week" (0282): for new accounts, one step
// for each part of Hound they ticked, then a Global challenge, with Bones
// for each and the Starter Bandana at the end. The server makes it, ticks
// and pays the steps (whenever Today asks), and says which just finished.

export type StarterStepId = 'goal' | 'fast' | 'move' | 'global';

export interface StarterStep {
  id: StarterStepId;
  doneAt: string | null;
  skipped: boolean;
  bones: number;
}

export interface StarterPath {
  show: boolean;
  steps: StarterStep[];
  endsAt: string | null;
  finishedAt: string | null;
  finishBones: number;
  bonesPaid: number;
  justDone: StarterStepId[];
}

export const STARTER_TEXT: Record<StarterStepId, { title: string; sub: string; button: string }> = {
  goal: { title: 'Hit your step goal for a day', sub: 'From your phone or watch', button: 'Goals' },
  fast: { title: 'Start your first fast', sub: 'Tap when you finish eating', button: 'Start' },
  move: { title: 'Log an activity', sub: 'Yoga, yard work, a routine, anything', button: 'Log' },
  global: { title: 'Join a Global challenge', sub: 'Everyone on Hound plays', button: 'Pick' },
};

function parse(d: any): StarterPath {
  return {
    show: !!d?.show,
    steps: (d?.steps ?? []).map((s: any) => ({ id: s.id, doneAt: s.done_at ?? null, skipped: !!s.skipped, bones: Number(s.bones ?? 0) })),
    endsAt: d?.ends_at ?? null,
    finishedAt: d?.finished_at ?? null,
    finishBones: Number(d?.finish_bones ?? 0),
    bonesPaid: Number(d?.bones_paid ?? 0),
    justDone: Array.isArray(d?.just_done) ? d.just_done : [],
  };
}

// Null before 0282 is run, or when it can't tell.
export async function getStarterPath(): Promise<StarterPath | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('my_starter_path', { p_local_date: localDayKey() });
  if (error) return null;
  return parse(data);
}

export async function skipStarterStep(step: StarterStepId): Promise<StarterPath> {
  if (!supabase) throw new Error('Not connected.');
  const { data, error } = await supabase.rpc('starter_skip', { p_step: step });
  if (error) throw new Error(error.message);
  return parse(data);
}

export async function claimStarter(): Promise<{ path: StarterPath; bones: number }> {
  if (!supabase) throw new Error('Not connected.');
  const { data, error } = await supabase.rpc('starter_claim');
  if (error) throw new Error(error.message);
  return { path: parse(data), bones: Number((data as any)?.bones ?? 0) };
}

export function starterLeft(p: StarterPath): StarterStep[] {
  return p.steps.filter((s) => !s.doneAt && !s.skipped);
}
