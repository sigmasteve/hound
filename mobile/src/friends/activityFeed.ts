import { supabase } from '../lib/supabase';
import { recordPhrase, type RecordKind } from '../records/personalRecords';

// The Friends tab's activity feed — see 0073_friend_activity_feed.sql.
// The server returns only accepted friends' highlights from the last 14
// days, never anything about a challenge beyond its kind.

export type FeedKind =
  | 'won_steps'
  | 'won_tictacgo'
  | 'won_chase_hunter'
  | 'won_chase_escape'
  | 'bingo_blackout'
  | 'streak_survived'
  | 'achievement'
  | 'personal_record';

export interface FeedEvent {
  id: string;
  userId: string;
  kind: FeedKind;
  // The badge name for an achievement; "kind:value" for a personal
  // record (0084); null otherwise.
  detail: string | null;
  occurredAt: string;
  name: string;
  initials: string;
  frameId: string | null;
  backgroundId: string | null;
  iconId: string | null;
}

// One row on screen. Several badges the same friend unlocked on the same
// day (a first-time catch-up can award a handful at once) collapse into a
// single "unlocked 3 achievements" row instead of flooding the feed.
export interface FeedItem extends Omit<FeedEvent, 'detail'> {
  badges: string[];
}

export async function getFriendActivityFeed(limit = 30): Promise<FeedEvent[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('friend_activity_feed', { p_limit: limit });
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((r) => ({
    id: r.event_id,
    userId: r.user_id,
    kind: r.kind,
    detail: r.detail,
    occurredAt: r.occurred_at,
    name: r.name,
    initials: r.initials,
    frameId: r.frame_id,
    backgroundId: r.background_id,
    iconId: r.icon_id,
  }));
}

function localDay(iso: string): string {
  return new Date(iso).toDateString();
}

// Input is newest-first (the RPC's own order); output keeps that order.
export function groupFeed(events: FeedEvent[]): FeedItem[] {
  const items: FeedItem[] = [];
  const achievementGroup = new Map<string, FeedItem>();
  for (const e of events) {
    if (e.kind === 'achievement') {
      const key = `${e.userId}|${localDay(e.occurredAt)}`;
      const existing = achievementGroup.get(key);
      if (existing) {
        if (e.detail) existing.badges.push(e.detail);
        continue;
      }
      const item: FeedItem = { ...e, badges: e.detail ? [e.detail] : [] };
      achievementGroup.set(key, item);
      items.push(item);
      continue;
    }
    // A record's "kind:value" rides along in badges, like a badge name.
    items.push({ ...e, badges: e.kind === 'personal_record' && e.detail ? [e.detail] : [] });
  }
  return items;
}

// What the friend did, without their name (the row shows that in bold).
export function feedAction(item: FeedItem, labels: { hunter: string }): string {
  switch (item.kind) {
    case 'won_steps':
      return 'won a Step Race';
    case 'won_tictacgo':
      return 'won a game of Tic-Tac-Go';
    case 'won_chase_hunter':
      return `caught everyone as the ${labels.hunter} in a Chase`;
    case 'won_chase_escape':
      return `escaped the ${labels.hunter} in a Chase`;
    case 'bingo_blackout':
      return 'filled a whole Bingo card';
    case 'streak_survived':
      return 'made it through a Daily Streak without a miss';
    case 'personal_record': {
      const [kind, value] = (item.badges[0] ?? '').split(':');
      const n = Number(value);
      return kind && Number.isFinite(n) ? `set a new record: ${recordPhrase(kind as RecordKind, n)}` : 'set a new personal record';
    }
    case 'achievement':
      if (item.badges.length <= 1) return `unlocked ${item.badges[0] ?? 'an achievement'}`;
      if (item.badges.length === 2) return `unlocked ${item.badges[0]} and ${item.badges[1]}`;
      return `unlocked ${item.badges.length} achievements`;
  }
}

export function timeAgo(iso: string, now: number = Date.now()): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}
