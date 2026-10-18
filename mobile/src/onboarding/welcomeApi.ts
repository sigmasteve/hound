import { supabase } from '../lib/supabase';
import type { ChallengeKind } from '../data/sampleData';
import type { GoalDraft } from '../goals/goals';

// The welcome wizard (0109_welcome_wizard.sql): whether to show it, and
// what someone said they'll use Hound for.

// Set once someone's dealt with connecting health on this phone (the
// wizard's first step, or the launch-time health prompt), so the prompt
// doesn't come back. Device-wide, not per account.
export const CONNECT_PROMPT_SEEN_KEY = 'hound:connect-prompt-seen';

export type HoundUse = 'steps' | 'workouts' | 'strength' | 'cardio' | 'friends' | 'habits';

export const HOUND_USES: { id: HoundUse; name: string; detail: string }[] = [
  { id: 'steps', name: 'Step & mile challenges', detail: 'Races and chases on your daily steps' },
  { id: 'workouts', name: 'Workout accountability', detail: 'Someone to keep you showing up' },
  { id: 'strength', name: 'Strength training', detail: 'Lifting and gym sessions' },
  { id: 'cardio', name: 'Running, cycling & cardio', detail: 'Miles and minutes' },
  { id: 'friends', name: 'Working out with friends', detail: 'Compete with people you know' },
  { id: 'habits', name: 'Building daily habits', detail: 'Streaks you don’t want to break' },
];

export interface WelcomeState {
  show: boolean;
  uses: HoundUse[];
}

// Null when it can't tell (before 0109 has run, or offline): don't show it.
export async function getWelcome(): Promise<WelcomeState | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('my_welcome');
  if (error) return null;
  const row = (Array.isArray(data) ? data[0] : data) as { show_wizard: boolean; uses: string[] } | undefined;
  if (!row) return null;
  return { show: row.show_wizard, uses: (row.uses ?? []) as HoundUse[] };
}

export async function saveHoundUses(uses: HoundUse[]): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc('save_hound_uses', { p_uses: uses });
  if (error) throw new Error(error.message);
}

export async function finishWelcome(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc('finish_welcome');
  if (error) throw new Error(error.message);
}

// Goals worth adding to the three starters for what they picked.
export function extraGoalsFor(uses: HoundUse[]): GoalDraft[] {
  const extra: GoalDraft[] = [];
  if (uses.includes('strength'))
    extra.push({ metric: 'workouts', period: 'week', target: 2, activity: 'strength', label: 'Strength a week' });
  if (uses.includes('cardio'))
    extra.push({ metric: 'workout_minutes', period: 'week', target: 150, activity: null, label: 'Cardio minutes a week' });
  return extra;
}

// The kind of challenge to suggest starting, from what they picked first
// in this order.
export function suggestedKind(uses: HoundUse[]): ChallengeKind {
  if (uses.includes('friends')) return 'hunt';
  if (uses.includes('steps')) return 'steps';
  if (uses.includes('strength') || uses.includes('workouts')) return 'bingo';
  if (uses.includes('cardio')) return 'distance';
  if (uses.includes('habits')) return 'streak';
  return 'steps';
}
