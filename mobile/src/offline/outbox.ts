import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getNetState, isNetworkError, onNetState, reportNetworkFailure, reportReachable } from './network';
import { offlineEnabled } from './offlineConfig';

// The outbox (0271): what you did while the server couldn't be reached
// waits here on the phone, in order, and goes to offline_apply when it can
// be. Each item has its own id, so sending one twice is harmless. One that
// a rule turns down (an overlap, a cap, too long ago) moves to "couldn't
// sync" with the reason, for the strip to show.

export type OutboxOp = 'move_offline_session' | 'log_workout' | 'fasting_start' | 'fasting_end' | 'log_water';

export interface OutboxItem {
  id: string;
  op: OutboxOp;
  args: Record<string, unknown>;
  // When it happened on the phone (ISO).
  doneAt: string;
  // What it was, for the strip ("Your Legs log").
  label: string;
}

export interface OutboxFailure {
  id: string;
  label: string;
  message: string;
}

const KEY = 'offline:outbox';
const FAILED_KEY = 'offline:outbox-failed';
const RETRY_MS = [3000, 10000, 30000, 60000];

let items: OutboxItem[] = [];
let failed: OutboxFailure[] = [];
let loaded: Promise<void> | null = null;
let flushing = false;
let tries = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const syncedListeners = new Set<(ops: OutboxOp[]) => void>();

export function newId(): string {
  // RFC 4122 v4, good enough for one person's own ids.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function load(): Promise<void> {
  if (!loaded) {
    loaded = (async () => {
      try {
        const [a, b] = await Promise.all([AsyncStorage.getItem(KEY), AsyncStorage.getItem(FAILED_KEY)]);
        items = a ? JSON.parse(a) : [];
        failed = b ? JSON.parse(b) : [];
      } catch {
        items = [];
        failed = [];
      }
      notify();
    })();
  }
  return loaded;
}

function save() {
  AsyncStorage.setItem(KEY, JSON.stringify(items)).catch(() => {});
  AsyncStorage.setItem(FAILED_KEY, JSON.stringify(failed)).catch(() => {});
}

function notify() {
  listeners.forEach((l) => l());
}

export function pendingItems(): OutboxItem[] {
  return items;
}

export async function enqueue(op: OutboxOp, args: Record<string, unknown>, label: string, id = newId()): Promise<OutboxItem> {
  await load();
  const item: OutboxItem = { id, op, args, doneAt: new Date().toISOString(), label };
  items = [...items, item];
  save();
  notify();
  schedule(0);
  return item;
}

// Taken back before it synced (a glass of water undone).
export async function removeQueued(id: string): Promise<boolean> {
  await load();
  const before = items.length;
  items = items.filter((i) => i.id !== id);
  if (items.length !== before) {
    save();
    notify();
    return true;
  }
  return false;
}

export function dismissFailures(): void {
  failed = [];
  save();
  notify();
}

function schedule(ms: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    flush();
  }, ms);
}

export async function flush(): Promise<void> {
  await load();
  if (flushing || items.length === 0 || !supabase) return;
  flushing = true;
  const synced: OutboxOp[] = [];
  try {
    while (items.length > 0) {
      const it = items[0];
      const { data, error } = await supabase.rpc('offline_apply', {
        p_client_id: it.id,
        p_op: it.op,
        p_args: it.args,
        p_done_at: it.doneAt,
      });
      if (error) {
        if (isNetworkError(error)) reportNetworkFailure();
        // Network, or the server isn't ready (0271 not run): try later.
        tries++;
        schedule(RETRY_MS[Math.min(tries - 1, RETRY_MS.length - 1)]);
        return;
      }
      reportReachable();
      tries = 0;
      items = items.slice(1);
      const err = (data as any)?.error;
      if (err) failed = [...failed, { id: it.id, label: it.label, message: String(err) }].slice(-10);
      else synced.push(it.op);
      save();
      notify();
    }
  } finally {
    flushing = false;
    if (synced.length) syncedListeners.forEach((l) => l(synced));
  }
}

// Does it now, or (offline mode on, and no connection or others already
// waiting) keeps it for later. Others waiting go first, so the order holds
// (a fast's end after its start).
export async function runOrQueue<T>(
  op: OutboxOp,
  args: Record<string, unknown>,
  label: string,
  direct: () => Promise<T>,
): Promise<{ queued: true; item: OutboxItem } | { queued: false; value: T }> {
  if (!offlineEnabled()) return { queued: false, value: await direct() };
  await load();
  if (items.length > 0 || getNetState() === 'offline') {
    return { queued: true, item: await enqueue(op, args, label) };
  }
  try {
    const value = await direct();
    reportReachable();
    return { queued: false, value };
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    reportNetworkFailure();
    return { queued: true, item: await enqueue(op, args, label) };
  }
}

onNetState((s) => {
  if (s === 'online') schedule(0);
});
load().then(() => schedule(1000));

export function onSynced(l: (ops: OutboxOp[]) => void): () => void {
  syncedListeners.add(l);
  return () => {
    syncedListeners.delete(l);
  };
}

export function useOutbox(): { pending: OutboxItem[]; failed: OutboxFailure[] } {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    load();
    return () => {
      listeners.delete(l);
    };
  }, []);
  return { pending: items, failed };
}
