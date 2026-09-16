import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import type { NotificationPreferences } from './types';

// Used from SettingsScreen's "Login reminders" card — see
// 0010_login_reminders.sql / send-login-reminders for the backend half
// of this feature.

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export async function getPreferences(userId: string): Promise<NotificationPreferences> {
  const client = requireClient();
  const { data, error } = await client
    .from('profiles')
    .select('notify_push_enabled, notify_email_enabled')
    .eq('id', userId)
    .single();
  if (error) throw new Error(error.message);
  return { pushEnabled: data.notify_push_enabled, emailEnabled: data.notify_email_enabled };
}

export async function setEmailEnabled(userId: string, enabled: boolean): Promise<void> {
  const client = requireClient();
  const { error } = await client.from('profiles').update({ notify_email_enabled: enabled }).eq('id', userId);
  if (error) throw new Error(error.message);
}

// Turning push on walks through the real OS permission + Expo push token
// dance the first time; turning it back off later is just the preference
// flip below — there's nothing to un-register.
export async function setPushEnabled(userId: string, enabled: boolean): Promise<void> {
  if (enabled) {
    // Throws (and leaves the preference untouched) on anything short of
    // "a real push token got registered" — the caller reverts its toggle
    // on that, same as any other action in this app that can fail.
    await registerForPushNotifications(userId);
  }
  const client = requireClient();
  const { error } = await client.from('profiles').update({ notify_push_enabled: enabled }).eq('id', userId);
  if (error) throw new Error(error.message);
}

async function registerForPushNotifications(userId: string): Promise<void> {
  // Push tokens aren't meaningful on a simulator/emulator — same "no real
  // sensor to read here" shape as src/health's mock fallback.
  if (!Device.isDevice) {
    throw new Error('Push notifications need a physical device — try email reminders instead.');
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let status = existingStatus;
  if (status !== 'granted') {
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  if (status !== 'granted') {
    throw new Error('Notifications are turned off for Hound in your device settings.');
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error('Missing EAS project id — cannot register for push.');

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

  const client = requireClient();
  const { error } = await client
    .from('device_push_tokens')
    .upsert(
      { user_id: userId, expo_push_token: token, platform: Platform.OS, updated_at: new Date().toISOString() },
      { onConflict: 'expo_push_token' },
    );
  if (error) throw new Error(error.message);
}

// Called on every app open with a real session (see
// src/auth/AuthContext.tsx), not just a fresh sign-in — a Supabase
// session can stay valid for weeks without the user ever seeing a
// sign-in screen again, so that alone would badly undercount who's
// actually using the app day to day. This is the one signal
// send-login-reminders checks to decide who's gone quiet today.
export async function touchLastActive(userId: string): Promise<void> {
  if (!supabase) return;
  await supabase.from('profiles').update({ last_active_at: new Date().toISOString() }).eq('id', userId);
}
