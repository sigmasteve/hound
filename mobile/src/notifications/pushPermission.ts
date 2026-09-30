import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { registerForPushNotifications } from './supabaseNotifications';

// Getting people onto push (0081_push_permission.sql). Server pushes only
// reach a phone registered in device_push_tokens, so:
//   * every app open registers the phone once notifications are allowed
//     — however they came to be allowed — and reports the phone's
//     setting for Admin;
//   * Today asks people who've never been asked (PushAskCard), with a
//     short explanation first, since iOS only shows its own prompt once;
//   * Settings explains how to turn them back on after "Don't Allow".

// 'undetermined' also covers "not allowed yet, but the phone will still
// show its prompt" — Android can ask a second time after one refusal.
export type PushPermission = 'granted' | 'denied' | 'undetermined';

// Web has no push, and a simulator can't get a push token.
export function pushSupported(): boolean {
  return Platform.OS !== 'web' && Device.isDevice;
}

// Null where push isn't supported, or the check fails.
export async function getPushPermission(): Promise<PushPermission | null> {
  if (!pushSupported()) return null;
  try {
    const { status, canAskAgain } = await Notifications.getPermissionsAsync();
    if (status === 'granted') return 'granted';
    return canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return null;
  }
}

async function reportPermission(userId: string, permission: PushPermission): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from('profiles').update({ push_permission: permission }).eq('id', userId);
  } catch {
    // Before 0081 has run, or offline — Admin just shows the last report.
  }
}

// On every app open (src/auth/AuthContext.tsx). Never prompts, never
// throws.
export async function syncPushRegistration(userId: string): Promise<void> {
  const permission = await getPushPermission();
  if (!permission) return;
  await reportPermission(userId, permission);
  if (permission === 'granted') {
    await registerForPushNotifications(userId).catch(() => {});
  }
}

// Shows the phone's own prompt, then registers if they allowed it.
// Returns what they chose.
export async function askForPush(userId: string): Promise<PushPermission | null> {
  if (!pushSupported()) return null;
  try {
    await Notifications.requestPermissionsAsync();
  } catch {
    // Read back whatever the phone ended up with below.
  }
  const permission = await getPushPermission();
  if (permission) await reportPermission(userId, permission);
  if (permission === 'granted') await registerForPushNotifications(userId).catch(() => {});
  return permission;
}

// After "Don't Allow", only the phone's Settings can turn them back on.
export function openPhoneSettings(): void {
  Linking.openSettings().catch(() => {});
}

// ── When Today offers it ─────────────────────────────────────────────

// Offered at most twice: once, then again a few days after "Not now".
const ASK_KEY = 'pushAskState';
const MAX_OFFERS = 2;
const REOFFER_AFTER_MS = 3 * 86_400_000;

interface AskState {
  dismissals: number;
  lastDismissedAt: number | null;
}

async function readAskState(): Promise<AskState> {
  try {
    const raw = await AsyncStorage.getItem(ASK_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return { dismissals: Number(s.dismissals) || 0, lastDismissedAt: Number(s.lastDismissedAt) || null };
    }
  } catch {
    // Fall through to "never offered".
  }
  return { dismissals: 0, lastDismissedAt: null };
}

export async function shouldOfferPush(): Promise<boolean> {
  if ((await getPushPermission()) !== 'undetermined') return false;
  const { dismissals, lastDismissedAt } = await readAskState();
  if (dismissals >= MAX_OFFERS) return false;
  return !lastDismissedAt || Date.now() - lastDismissedAt >= REOFFER_AFTER_MS;
}

export async function dismissPushOffer(): Promise<void> {
  const { dismissals } = await readAskState();
  try {
    await AsyncStorage.setItem(ASK_KEY, JSON.stringify({ dismissals: dismissals + 1, lastDismissedAt: Date.now() }));
  } catch {
    // Worst case it's offered again next open.
  }
}
