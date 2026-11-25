import { supabase } from '../lib/supabase';

// The welcome wizard (0109_welcome_wizard.sql): whether to show it, and
// what someone said they'll use Hound for.

// Set once someone's dealt with connecting health on this phone (the
// wizard's first step, or the launch-time health prompt), so the prompt
// doesn't come back. Device-wide, not per account.
export const CONNECT_PROMPT_SEEN_KEY = 'hound:connect-prompt-seen';

// The wizard's checkboxes (0272), plus the chips from before it (cardio,
// habits, other), which still save so nothing anyone picked is lost.
export type HoundUse = 'steps' | 'fasting' | 'workouts' | 'activities' | 'strength' | 'water' | 'friends' | 'cardio' | 'habits' | 'other';

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
