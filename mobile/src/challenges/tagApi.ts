import { supabase } from '../lib/supabase';
import { displayInitials, displayName, type DisplayableProfile } from '../profiles/displayName';
import type { DistanceGoalUnit, TagRound } from './types';

// The client-facing half of Game of Tag — see 0044_tag_challenge_kind.sql
// / 0045_tag_game_state.sql for the schema and RPCs this wraps, and
// GitHub's own design discussion for the mechanic itself. No screen
// calls any of this yet — a target-picker screen and a Home screen
// "you've been tagged" banner are real follow-up work once this backend
// foundation is in place, same "the flag exists before a screen needs
// it" shape organizations/supabaseOrganizations.ts was built with.

// How long IT has, from the moment their turn starts, to both pick a
// target and catch them — matches TAG_TIME_LIMIT_MINUTES's
// server-side twin (0045_tag_game_state.sql's own tag_settle_timeout).
// Hardcoded for now rather than creator-configurable, on purpose (see
// GitHub discussion): kept short and fixed while the mechanic itself is
// still being validated, with a per-challenge picker (mirroring Chase's
// own head-start slider) as real follow-up work once it is.
export const TAG_TIME_LIMIT_MINUTES = 15;

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

// A tag-specific participant view — same identity fields
// supabaseChallenges.ts's own listParticipants already returns, plus
// the two tag-only facts a target picker needs: who last tagged them
// (to grey out/exclude that one option — no tag-backs) and how many
// people they've caught so far.
export interface TagMember {
  userId: string;
  name: string;
  initials: string;
  lastTaggedBy: string | null;
  tagsMade: number;
}

interface TagMemberProfileRow {
  name: string;
  initials: string;
  username: string | null;
  use_username: boolean;
}

function toDisplayable(p: TagMemberProfileRow): DisplayableProfile & { initials: string } {
  return { name: p.name, initials: p.initials, username: p.username, useUsername: p.use_username };
}

interface TagRoundRow {
  challenge_id: string;
  it_user_id: string;
  target_user_id: string | null;
  target_snapshot_metric: number | null;
  round_started_at: string;
}

function rowToTagRound(row: TagRoundRow): TagRound {
  return {
    challengeId: row.challenge_id,
    itUserId: row.it_user_id,
    targetUserId: row.target_user_id,
    targetSnapshotMetric: row.target_snapshot_metric,
    roundStartedAt: row.round_started_at,
  };
}

// RLS already restricts this to the challenge's own participants (see
// 0045_tag_game_state.sql) — a null result here means either the
// challenge isn't a 'tag' kind (no round ever existed for it) or the
// caller isn't a participant, which this deliberately doesn't
// distinguish, same as any other RLS-gated single-row fetch elsewhere
// in this app.
export async function getTagRound(challengeId: string): Promise<TagRound | null> {
  const client = requireClient();
  const { data, error } = await client
    .from('tag_rounds')
    .select('challenge_id, it_user_id, target_user_id, target_snapshot_metric, round_started_at')
    .eq('challenge_id', challengeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToTagRound(data) : null;
}

// Every current participant, with the two tag-only facts above — same
// RLS this challenge's own listParticipants already relies on
// (challenge_participants' "Participants can view each other" policy),
// nothing extra to bypass.
export async function listTagMembers(challengeId: string): Promise<TagMember[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('challenge_participants')
    .select('user_id, last_tagged_by, tags_made, profiles(name, initials, username, use_username)')
    .eq('challenge_id', challengeId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const profile = row.profiles as unknown as TagMemberProfileRow | null;
    return {
      userId: row.user_id,
      name: profile ? displayName(toDisplayable(profile)) : 'Someone',
      initials: profile ? displayInitials(toDisplayable(profile)) : '?',
      lastTaggedBy: row.last_tagged_by,
      tagsMade: row.tags_made,
    };
  });
}

// Only the current IT can call this — enforced server-side
// (tag_select_target). Settles a stalled round first, so a caller whose
// own turn already timed out gets a clear "you're not currently IT"
// error instead of the pick silently landing on a round that's already
// moved on.
export async function selectTagTarget(challengeId: string, targetUserId: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc('tag_select_target', { challenge_id: challengeId, target_user_id: targetUserId });
  if (error) throw new Error(error.message);
}

// Re-checks IT's own current cumulative total against the target's
// snapshotted one, from scratch, server-side — never trusts anything
// the client itself computed. Returns true the instant this call is the
// one that closes the gap; false otherwise (including if the caller
// isn't currently IT, or IT hasn't picked a target yet). Meant to be
// called after every device sync while the caller is IT, same "the
// client notices, then persists it" shape markCaught already uses for
// a hunt's own catch.
export async function checkTagCatch(challengeId: string): Promise<boolean> {
  const client = requireClient();
  const { data, error } = await client.rpc('tag_check_catch', { challenge_id: challengeId });
  if (error) throw new Error(error.message);
  return data as boolean;
}

// A no-op unless the current round has genuinely run past
// TAG_TIME_LIMIT_MINUTES with no catch, in which case IT passes to a
// random other participant — callable by any participant (not just
// IT), e.g. right after loading the challenge, so a stalled game moves
// on the next time anyone looks at it rather than needing a scheduled
// job.
export async function settleTagTimeout(challengeId: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc('tag_settle_timeout', { challenge_id: challengeId });
  if (error) throw new Error(error.message);
}

// A participant's own current cumulative total for this challenge, in
// whichever unit its own distanceGoalUnit says matters — the same
// number tag_check_catch itself compares against, exposed directly so
// a future UI can show "you need N more steps/miles to catch them"
// without waiting on a full leaderboard re-fetch.
export async function getTagMetricTotal(challengeId: string, userId: string, unit: DistanceGoalUnit): Promise<number> {
  const client = requireClient();
  const { data, error } = await client.rpc('tag_metric_total', {
    p_challenge_id: challengeId,
    p_user_id: userId,
    p_unit: unit,
  });
  if (error) throw new Error(error.message);
  return data as number;
}
