import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

// Maintenance (0190_maintenance.sql) and what the app does when Hound's
// server can't be reached.
//
// As the app opens (and each time it comes back to the front) it asks the
// server for the maintenance window, with a time limit:
//   1. An answer: carry on, unless Admin's "Maintenance now" is on. The
//      window is saved on the phone for step 3.
//   2. No answer: read houndchallenge.net/status.json (the website, which
//      stays up when Supabase doesn't). "maintenance": true → the
//      maintenance screen with its message.
//   3. Otherwise, inside the saved window → the maintenance screen.
//   4. Otherwise → "Hound can't reach its server".
// Screens 2 to 4 retry every 15 seconds and open Hound once it answers.

export const STATUS_URL = 'https://houndchallenge.net/status.json';
const CACHE_KEY = 'maintenance:window';
const PING_MS = 8000;
const STATUS_MS = 5000;

export interface MaintenanceWindow {
  message: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  headsUpHours: number;
  nowOn: boolean;
}

export type ServerState =
  | { kind: 'ok'; window: MaintenanceWindow | null }
  | { kind: 'maintenance'; message: string | null; until: Date | null; now: boolean }
  | { kind: 'down' };

function toDate(v: unknown): Date | null {
  if (typeof v !== 'string' || !v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function windowFromRow(row: any): MaintenanceWindow {
  return {
    message: row?.message ?? null,
    startsAt: toDate(row?.starts_at),
    endsAt: toDate(row?.ends_at),
    headsUpHours: Number(row?.heads_up_hours ?? 6),
    nowOn: !!row?.now_on,
  };
}

function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    Promise.resolve(p).then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function saveWindow(w: MaintenanceWindow): Promise<void> {
  try {
    await AsyncStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ message: w.message, startsAt: w.startsAt?.toISOString() ?? null, endsAt: w.endsAt?.toISOString() ?? null }),
    );
  } catch {
    // Only a copy for when the server is down.
  }
}

async function savedWindow(): Promise<{ message: string | null; startsAt: Date | null; endsAt: Date | null } | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return { message: v.message ?? null, startsAt: toDate(v.startsAt), endsAt: toDate(v.endsAt) };
  } catch {
    return null;
  }
}

// The website's status file. Null when it can't be read either.
export async function readStatusFile(): Promise<{ maintenance: boolean; message: string | null; until: Date | null } | null> {
  try {
    const res = await withTimeout(fetch(`${STATUS_URL}?t=${Date.now()}`, { cache: 'no-store' } as RequestInit), STATUS_MS);
    if (!res.ok) return null;
    const v = (await res.json()) as any;
    return { maintenance: v?.maintenance === true, message: typeof v?.message === 'string' ? v.message : null, until: toDate(v?.until) };
  } catch {
    return null;
  }
}

// One check, in the order above.
export async function checkServer(): Promise<ServerState> {
  if (!supabase) return { kind: 'ok', window: null };
  let reached = false;
  let window: MaintenanceWindow | null = null;
  try {
    const res = await withTimeout(supabase.from('app_maintenance').select('*').eq('id', true).maybeSingle(), PING_MS);
    // A 4xx (say 0190 hasn't run yet) still means the server answered;
    // no status, or a 5xx while the project restarts, means it didn't.
    const status = (res as any).status as number | undefined;
    reached = !!status && status > 0 && status < 500;
    if (reached && !res.error && res.data) window = windowFromRow(res.data);
  } catch {
    reached = false;
  }

  if (reached) {
    if (window) {
      saveWindow(window);
      if (window.nowOn) return { kind: 'maintenance', message: window.message, until: window.endsAt, now: true };
    }
    return { kind: 'ok', window };
  }

  const file = await readStatusFile();
  if (file?.maintenance) return { kind: 'maintenance', message: file.message, until: file.until, now: false };

  const saved = await savedWindow();
  const now = Date.now();
  if (saved?.startsAt && saved.endsAt && now >= saved.startsAt.getTime() - 15 * 60_000 && now <= saved.endsAt.getTime() + 30 * 60_000) {
    return { kind: 'maintenance', message: saved.message, until: saved.endsAt, now: false };
  }
  return { kind: 'down' };
}

// Today's heads-up: from heads_up_hours before the window until it ends.
export function headsUpActive(w: MaintenanceWindow | null, at: Date = new Date()): boolean {
  if (!w?.startsAt || !w.endsAt) return false;
  const t = at.getTime();
  return t >= w.startsAt.getTime() - w.headsUpHours * 3_600_000 && t < w.endsAt.getTime();
}

export async function getMaintenanceWindow(): Promise<MaintenanceWindow | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('app_maintenance').select('*').eq('id', true).maybeSingle();
  if (error || !data) return null;
  const w = windowFromRow(data);
  saveWindow(w);
  return w;
}

export async function markMaintenanceSeen(startsAt: Date): Promise<void> {
  if (!supabase) return;
  await supabase.rpc('mark_maintenance_seen', { p_starts_at: startsAt.toISOString() });
}

// ── Admin ──

export interface MaintenanceOverview extends MaintenanceWindow {
  seen: number;
  windows: number;
  seenAll: number;
}

export async function getMaintenanceOverview(): Promise<MaintenanceOverview> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { data, error } = await supabase.rpc('admin_maintenance_overview');
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as any;
  return { ...windowFromRow(d), seen: Number(d.seen ?? 0), windows: Number(d.windows ?? 0), seenAll: Number(d.seen_all ?? 0) };
}

export async function setMaintenance(message: string, startsAt: Date, minutes: number): Promise<void> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { error } = await supabase.rpc('admin_set_maintenance', { p_message: message, p_starts_at: startsAt.toISOString(), p_minutes: minutes });
  if (error) throw new Error(error.message);
}

export async function clearMaintenance(): Promise<void> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { error } = await supabase.rpc('admin_clear_maintenance');
  if (error) throw new Error(error.message);
}

export async function setMaintenanceNow(on: boolean): Promise<void> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { error } = await supabase.rpc('admin_set_maintenance_now', { p_on: on });
  if (error) throw new Error(error.message);
}

// "Tonight 9:00 pm", "Tomorrow 6:30 am", "Fri, Nov 14 9:00 pm".
export function whenLabel(d: Date, now: Date = new Date()): string {
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86_400_000);
  if (diff === 0) return `${d.getHours() >= 17 ? 'Tonight' : 'Today'} ${time}`;
  if (diff === 1) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} ${time}`;
}

export function timeLabel(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60_000);
}
