import { supabase } from '../lib/supabase';
import { registerForPushNotifications } from '../notifications/supabaseNotifications';

// Nudges and challenge reactions (0082_nudges_reactions.sql).

export const REACTION_EMOJI = ['🔥', '💪', '👏', '😮'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJI)[number];

// One nudge per person per this long (send_nudge's own limit).
export const NUDGE_COOLDOWN_HOURS = 20;

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

// The caller's own calendar day, which is what reactions are counted by.
export function localDayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Nudges ───────────────────────────────────────────────────────────

// Returns whether a push went out — false means they'll only see it on
// their Today (no phone registered, or they've turned these off).
export async function sendNudge(toUserId: string, challengeId?: string | null): Promise<{ pushed: boolean }> {
  const { data, error } = await requireClient().rpc('send_nudge', {
    p_to: toUserId,
    p_challenge_id: challengeId ?? null,
  });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as { pushed: boolean } | undefined;
  return { pushed: !!row?.pushed };
}

// userId → when the caller last nudged them, within the cooldown.
export async function myRecentNudges(): Promise<Map<string, string>> {
  const { data, error } = await requireClient().rpc('my_recent_nudges');
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as { to_user: string; created_at: string }[]).map((r) => [r.to_user, r.created_at]));
}

// "You can nudge them again in 7h." — null once they can nudge again.
export function nudgeAgainLabel(lastAt: string | undefined, now = Date.now()): string | null {
  if (!lastAt) return null;
  const msLeft = new Date(lastAt).getTime() + NUDGE_COOLDOWN_HOURS * 3_600_000 - now;
  if (msLeft <= 0) return null;
  const hours = Math.ceil(msLeft / 3_600_000);
  return hours <= 1 ? 'You can nudge them again in under an hour.' : `You can nudge them again in ${hours}h.`;
}

export interface ReceivedNudge {
  fromUserId: string;
  name: string;
  initials: string;
  frameId: string | null;
  backgroundId: string | null;
  iconId: string | null;
  challengeId: string | null;
  challengeName: string | null;
  createdAt: string;
}

// Nudges from the last day — one per person, newest first.
export async function nudgesReceived(): Promise<ReceivedNudge[]> {
  const { data, error } = await requireClient().rpc('nudges_received');
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[])
    .map((r) => ({
      fromUserId: r.from_user,
      name: r.name,
      initials: r.initials,
      frameId: r.frame_id,
      backgroundId: r.background_id,
      iconId: r.icon_id,
      challengeId: r.challenge_id,
      challengeName: r.challenge_name,
      createdAt: r.created_at,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ── Reactions ────────────────────────────────────────────────────────

export interface Reaction {
  toUserId: string;
  emoji: ReactionEmoji;
  fromUserId: string;
  fromName: string;
}

export async function reactionsForDay(challengeId: string, day = localDayKey()): Promise<Reaction[]> {
  const { data, error } = await requireClient().rpc('challenge_reactions_for_day', {
    p_challenge_id: challengeId,
    p_day: day,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((r) => ({
    toUserId: r.to_user,
    emoji: r.emoji,
    fromUserId: r.from_user,
    fromName: r.from_name,
  }));
}

// Adds the reaction, or takes it back. Returns whether it's on now.
export async function toggleReaction(
  challengeId: string,
  toUserId: string,
  emoji: ReactionEmoji,
  day = localDayKey(),
): Promise<boolean> {
  const { data, error } = await requireClient().rpc('toggle_reaction', {
    p_challenge_id: challengeId,
    p_to: toUserId,
    p_emoji: emoji,
    p_day: day,
  });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as { reacted: boolean } | undefined;
  return !!row?.reacted;
}

// Applies a toggle to a local list, so the leaderboard updates without
// waiting on a reload.
export function applyToggle(
  reactions: Reaction[],
  me: { id: string; name: string },
  toUserId: string,
  emoji: ReactionEmoji,
  on: boolean,
): Reaction[] {
  const rest = reactions.filter((r) => !(r.fromUserId === me.id && r.toUserId === toUserId && r.emoji === emoji));
  return on ? [...rest, { toUserId, emoji, fromUserId: me.id, fromName: me.name }] : rest;
}

export interface ReactionSummary {
  emoji: ReactionEmoji;
  count: number;
  mine: boolean;
  names: string[];
}

// One person's reactions today, in the bar's order.
export function summarize(reactions: Reaction[], toUserId: string, myId: string | undefined): ReactionSummary[] {
  return REACTION_EMOJI.map((emoji) => {
    const matching = reactions.filter((r) => r.toUserId === toUserId && r.emoji === emoji);
    return {
      emoji,
      count: matching.length,
      mine: matching.some((r) => r.fromUserId === myId),
      names: matching.map((r) => (r.fromUserId === myId ? 'You' : r.fromName)),
    };
  }).filter((s) => s.count > 0);
}

// ── Settings ─────────────────────────────────────────────────────────

// Null if it can't be read (e.g. before 0082 has run) — Settings then
// just leaves the toggle out.
export async function getSocialPushEnabled(userId: string): Promise<boolean | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('alert_social_push_enabled')
    .eq('id', userId)
    .single<{ alert_social_push_enabled: boolean }>();
  if (error || !data) return null;
  return data.alert_social_push_enabled;
}

// Same as Settings' other push toggles: turning it on registers this
// phone first, and throws if notifications aren't allowed.
export async function setSocialPushEnabled(userId: string, enabled: boolean): Promise<void> {
  if (enabled) await registerForPushNotifications(userId);
  const { error } = await requireClient()
    .from('profiles')
    .update({ alert_social_push_enabled: enabled })
    .eq('id', userId);
  if (error) throw new Error(error.message);
}
