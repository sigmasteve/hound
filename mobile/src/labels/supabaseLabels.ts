import { supabase } from '../lib/supabase';
import type { HuntLabels } from './types';

// Used from SettingsScreen's "Chase labels" card — see
// 0015_app_labels.sql for the backend half (a single shared row, app-wide
// for now; see that migration's own comment on the per-organization
// follow-up this deliberately isn't yet).

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export async function getHuntLabels(): Promise<HuntLabels> {
  const client = requireClient();
  const { data, error } = await client
    .from('app_labels')
    .select('hunter_label, hunted_label, zombie_label')
    .eq('id', true)
    .single();
  if (error) throw new Error(error.message);
  return { hunter: data.hunter_label, hunted: data.hunted_label, zombie: data.zombie_label };
}

export async function setHuntLabels(labels: HuntLabels): Promise<void> {
  const client = requireClient();
  const { error } = await client
    .from('app_labels')
    .update({
      hunter_label: labels.hunter,
      hunted_label: labels.hunted,
      zombie_label: labels.zombie,
      updated_at: new Date().toISOString(),
    })
    .eq('id', true);
  if (error) throw new Error(error.message);
}

