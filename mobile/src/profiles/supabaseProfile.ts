import { supabase } from '../lib/supabase';

// Used from SettingsScreen's "Username" card — see 0030_username.sql for
// the column/constraints this writes to.

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

// Postgres error code for a unique-index violation — surfaced as a
// specific "that username is taken" message rather than the generic
// constraint-violation text, same "translate the one error a caller
// actually needs to react to" reasoning admin/adminApi.ts's deleteUser()
// uses for its own non-2xx body.
const UNIQUE_VIOLATION = '23505';

export async function setUsername(userId: string, username: string | null): Promise<void> {
  const client = requireClient();
  const { error } = await client.from('profiles').update({ username }).eq('id', userId);
  if (error) {
    if (error.code === UNIQUE_VIOLATION) throw new Error('That username is already taken.');
    throw new Error(error.message);
  }
}

export async function setUseUsername(userId: string, useUsername: boolean): Promise<void> {
  const client = requireClient();
  const { error } = await client.from('profiles').update({ use_username: useUsername }).eq('id', userId);
  if (error) throw new Error(error.message);
}
