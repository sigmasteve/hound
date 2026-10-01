import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';
import { isMissingFunction } from '../lib/rpcFallback';

// This phone's push token, and who it belongs to (H7 in Roshan Trivedi's
// security review). A phone's token used to stay with whoever signed in
// on it first: signing out left the row in place, and the next person's
// upsert was refused because the row wasn't theirs — so the first person
// kept getting pushes on a phone they'd signed out of.

const TOKEN_KEY = 'houndPushToken';

// Saves the token on this phone under whoever is signed in now.
// claim_push_token (0091_security_followups.sql) moves it from a previous
// account; before 0091 has run, falls back to the old upsert.
export async function claimPushToken(userId: string, token: string, platform: string): Promise<void> {
  if (!supabase) return;
  await AsyncStorage.setItem(TOKEN_KEY, token).catch(() => {});
  const { error } = await supabase.rpc('claim_push_token', { p_token: token, p_platform: platform });
  if (!error) return;
  if (!isMissingFunction(error)) throw new Error(error.message);
  const { error: upsertError } = await supabase
    .from('device_push_tokens')
    .upsert(
      { user_id: userId, expo_push_token: token, platform, updated_at: new Date().toISOString() },
      { onConflict: 'expo_push_token' },
    );
  if (upsertError) throw new Error(upsertError.message);
}

// On sign-out, while still signed in: removes this phone's token from the
// account and cancels this person's scheduled reminders on the phone.
// Never throws — signing out must always work.
export async function forgetThisDevice(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (token && supabase) {
      await supabase.from('device_push_tokens').delete().eq('expo_push_token', token);
    }
  } catch {
    // Offline: the next person to sign in on this phone claims it anyway.
  }
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    // Web, or notifications unavailable.
  }
}
