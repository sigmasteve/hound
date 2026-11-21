import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

// Muting Today's Needs you for a while (Steve, Nov 2026). The mute is this
// phone's (it's this phone's Today); the server only records it for Admin
// (0240). Pushes aren't touched.

const KEY = 'hound:needs-you-muted-until';

export type MuteLength = 2 | 4 | 12 | 'morning';

export const MUTE_CHOICES: { length: MuteLength; label: string }[] = [
  { length: 2, label: 'For 2 hours' },
  { length: 4, label: 'For 4 hours' },
  { length: 12, label: 'For half a day' },
  { length: 'morning', label: 'Until tomorrow morning' },
];

// When a mute picked now ends: 8am tomorrow for "until tomorrow morning".
export function muteEnd(length: MuteLength, now: Date = new Date()): Date {
  if (length === 'morning') {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8, 0, 0);
    return d;
  }
  return new Date(now.getTime() + length * 3600_000);
}

export async function getMutedUntil(): Promise<Date | null> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    if (!v) return null;
    const d = new Date(v);
    return Number.isFinite(d.getTime()) && d.getTime() > Date.now() ? d : null;
  } catch {
    return null;
  }
}

export async function muteNeedsYou(length: MuteLength, waiting: number): Promise<Date> {
  const until = muteEnd(length);
  await AsyncStorage.setItem(KEY, until.toISOString()).catch(() => {});
  supabase
    ?.rpc('log_needs_you_mute', { p_hours: length === 'morning' ? 0 : length, p_until: until.toISOString(), p_waiting: waiting })
    .then(
      () => {},
      () => {},
    );
  return until;
}

export async function unmuteNeedsYou(): Promise<void> {
  await AsyncStorage.removeItem(KEY).catch(() => {});
  supabase?.rpc('log_needs_you_unmute').then(
    () => {},
    () => {},
  );
}

// "11:44 PM", or "tomorrow 8:00 AM".
export function untilLabel(until: Date, now: Date = new Date()): string {
  const time = until.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return until.toDateString() === now.toDateString() ? time : `tomorrow ${time}`;
}

export interface NeedsYouOverview {
  mutedNow: number;
  everMuted: number;
  muters7d: number;
  mutes7d: number;
  byLength7d: { h2: number; h4: number; h12: number; morning: number };
  unmutedEarly7d: number;
  avgWaiting7d: number | null;
  topMuters: { name: string; mutes: number }[];
}

export async function getNeedsYouOverview(): Promise<NeedsYouOverview> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { data, error } = await supabase.rpc('admin_needs_you_overview');
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as any;
  const n = (v: unknown) => Number(v ?? 0);
  return {
    mutedNow: n(d.mutedNow),
    everMuted: n(d.everMuted),
    muters7d: n(d.muters7d),
    mutes7d: n(d.mutes7d),
    byLength7d: { h2: n(d.byLength7d?.h2), h4: n(d.byLength7d?.h4), h12: n(d.byLength7d?.h12), morning: n(d.byLength7d?.morning) },
    unmutedEarly7d: n(d.unmutedEarly7d),
    avgWaiting7d: d.avgWaiting7d == null ? null : n(d.avgWaiting7d),
    topMuters: ((d.topMuters ?? []) as any[]).map((x) => ({ name: x.name ?? 'Someone', mutes: n(x.mutes) })),
  };
}

export function needsYouSummary(o: NeedsYouOverview): string {
  if (o.everMuted === 0) return 'Nobody has muted it yet';
  return `${o.mutedNow} muted now · ${o.muters7d} muted it this week`;
}
