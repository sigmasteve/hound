import { supabase } from '../lib/supabase';

// Send a push (0228_broadcast_push.sql): Admin writes one push to
// everyone who can get one (a phone registered, "News and challenge
// invites" on), optionally inviting them to a Global challenge they can
// still join; one a day. The send-broadcast-push Edge Function sends it.

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

async function rpc<T = any>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireClient().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

const num = (v: unknown) => Number(v ?? 0);

export const TITLE_MAX = 50;
export const MESSAGE_MAX = 150;

export type BroadcastAudience = 'all' | 'not_in';

export interface BroadcastPreview {
  reach: number;
  alreadyIn: number;
  turnedOff: number;
  // When the next push can go, if one went in the last day.
  nextAt: string | null;
}

export async function previewBroadcast(challengeId: string | null, audience: BroadcastAudience): Promise<BroadcastPreview> {
  const d = await rpc<any>('admin_broadcast_preview', { p_challenge_id: challengeId, p_audience: audience });
  return { reach: num(d?.reach), alreadyIn: num(d?.already_in), turnedOff: num(d?.turned_off), nextAt: d?.next_at ?? null };
}

export async function sendBroadcast(title: string, message: string, challengeId: string | null, audience: BroadcastAudience): Promise<string> {
  return rpc<string>('admin_send_broadcast', { p_title: title, p_message: message, p_challenge_id: challengeId, p_audience: audience });
}

// Send only to me (0229): the same push to the admin's own phone, to try
// the wording. Doesn't use the day's push or show in the history.
export async function sendBroadcastTest(title: string, message: string, challengeId: string | null): Promise<void> {
  await rpc('admin_send_broadcast_test', { p_title: title, p_message: message, p_challenge_id: challengeId });
}

// Someone tapped it. Counted once; failures don't matter to them.
export async function markBroadcastOpened(broadcastId: string): Promise<void> {
  await rpc('broadcast_opened', { p_broadcast_id: broadcastId });
}

export interface BroadcastRow {
  id: string;
  title: string;
  message: string;
  challengeId: string | null;
  challengeName: string | null;
  audience: BroadcastAudience;
  recipients: number;
  delivered: number | null;
  status: 'sending' | 'sent' | 'failed';
  error: string | null;
  createdAt: string;
  opened: number;
  // Joined the challenge within a day of it going out (an invite only).
  joined: number | null;
}

export interface BroadcastOverview {
  reach: number;
  turnedOff: number;
  nextAt: string | null;
  sentAll: number;
  broadcasts: BroadcastRow[];
}

export async function getBroadcastOverview(): Promise<BroadcastOverview> {
  const d = await rpc<any>('admin_broadcast_overview');
  return {
    reach: num(d?.reach),
    turnedOff: num(d?.turned_off),
    nextAt: d?.next_at ?? null,
    sentAll: num(d?.sent_all),
    broadcasts: ((d?.broadcasts ?? []) as any[]).map((b) => ({
      id: b.id,
      title: b.title ?? '',
      message: b.message ?? '',
      challengeId: b.challenge_id ?? null,
      challengeName: b.challenge_name ?? null,
      audience: b.audience === 'not_in' ? 'not_in' : 'all',
      recipients: num(b.recipients),
      delivered: b.delivered == null ? null : num(b.delivered),
      status: b.status === 'sent' || b.status === 'failed' ? b.status : 'sending',
      error: b.error ?? null,
      createdAt: b.created_at,
      opened: num(b.opened),
      joined: b.joined == null ? null : num(b.joined),
    })),
  };
}

export function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((100 * part) / whole)}%` : '–';
}

export function broadcastSummary(o: BroadcastOverview): string {
  const last = o.broadcasts[0];
  if (!last) return `${o.reach.toLocaleString()} can get one · none sent yet`;
  return `Last: ${last.recipients.toLocaleString()} sent · ${last.opened.toLocaleString()} opened${last.joined != null ? ` · ${last.joined.toLocaleString()} joined` : ''}`;
}

// "9:14am tomorrow", "9:14am Sat": when the next push can go.
export function nextAtLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const day =
    d.toDateString() === now.toDateString() ? 'today' : d.toDateString() === tomorrow.toDateString() ? 'tomorrow' : d.toLocaleDateString(undefined, { weekday: 'short' });
  return `${time} ${day}`;
}
