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

// 0030_username.sql's profiles_username_format, checked before saving so
// the message can say what's allowed.
export const USERNAME_FORMAT = /^[A-Za-z0-9_]{3,20}$/;

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

// Sets your name and initials (0119_set_my_name.sql); the server tidies
// the spaces and throws its own message for a name that's blank or too
// long. Also saved on the sign-in account, so Supabase's user list shows
// it and setup stops asking (supabaseAuth's hasSignUpName).
export async function setMyName(name: string): Promise<{ name: string; initials: string }> {
  const client = requireClient();
  const { data, error } = await client.rpc('set_my_name', { p_name: name }).single();
  if (error) throw new Error(error.message);
  const row = data as { name: string; initials: string };
  await client.auth.updateUser({ data: { name: row.name } }).catch(() => {});
  return row;
}

// Picking a username (the setup wizard, or Settings the first time) also
// turns it on for leaderboards and challenges: someone who chose one wants
// to be seen by it. They can still turn it off in Settings.
export async function chooseUsername(userId: string, username: string): Promise<void> {
  await setUsername(userId, username);
  await setUseUsername(userId, true);
}
