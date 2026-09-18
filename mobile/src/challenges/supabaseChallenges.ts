import { supabase } from '../lib/supabase';
import type {
  Challenge,
  ChallengeBot,
  ChallengeInvite,
  ChallengesProvider,
  CreateChallengeInput,
  HuntRole,
  LeaderboardEntry,
  Participant,
} from './types';

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

async function requireUserId(): Promise<string> {
  const { data } = await requireClient().auth.getUser();
  if (!data.user) throw new Error('Sign in to do that.');
  return data.user.id;
}

const CHALLENGE_COLUMNS =
  'id, name, kind, created_by, duration_days, starts_at, ends_at, daily_goal_steps, scoring_method, head_start_days, distance_goal_mi, distance_goal_steps, distance_goal_unit';

interface ChallengeRow {
  id: string;
  name: string;
  kind: Challenge['kind'];
  created_by: string;
  duration_days: number;
  starts_at: string;
  ends_at: string;
  daily_goal_steps: number | null;
  scoring_method: Challenge['scoringMethod'];
  head_start_days: number | null;
  distance_goal_mi: number | null;
  distance_goal_steps: number | null;
  distance_goal_unit: Challenge['distanceGoalUnit'];
}

interface ChallengeInviteRow {
  id: string;
  challenges: { id: string; name: string; kind: Challenge['kind']; duration_days: number } | null;
  inviter: { name: string } | null;
  role: HuntRole | null;
}

function rowToChallenge(row: ChallengeRow): Challenge {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    createdBy: row.created_by,
    durationDays: row.duration_days,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    dailyGoalSteps: row.daily_goal_steps,
    scoringMethod: row.scoring_method,
    headStartDays: row.head_start_days,
    distanceGoalMi: row.distance_goal_mi,
    distanceGoalSteps: row.distance_goal_steps,
    // Every pool created before 0013_distance_pool_unit.sql set
    // distance_goal_mi with no unit at all, in miles — read that
    // exactly as it already meant, rather than as "no goal."
    distanceGoalUnit: row.distance_goal_unit ?? (row.distance_goal_mi != null ? 'miles' : null),
  };
}

export const supabaseChallengesProvider: ChallengesProvider = {
  async listMyChallenges(): Promise<Challenge[]> {
    const client = requireClient();
    const { data, error } = await client
      .from('challenges')
      .select(CHALLENGE_COLUMNS)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(rowToChallenge);
  },

  async getChallenge(challengeId: string): Promise<Challenge> {
    const client = requireClient();
    const { data, error } = await client
      .from('challenges')
      .select(CHALLENGE_COLUMNS)
      .eq('id', challengeId)
      .single();
    if (error) throw new Error(error.message);
    return rowToChallenge(data);
  },

  async listParticipants(challengeId: string): Promise<Participant[]> {
    const client = requireClient();
    const { data, error } = await client
      .from('challenge_participants')
      .select('user_id, role, highlighted, profiles(name, initials)')
      .eq('challenge_id', challengeId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => {
      const profile = row.profiles as unknown as { name: string; initials: string } | null;
      return {
        userId: row.user_id,
        name: profile?.name ?? 'Someone',
        initials: profile?.initials ?? '?',
        role: (row.role as HuntRole | null) ?? null,
        highlighted: row.highlighted,
      };
    });
  },

  async listBots(challengeId: string): Promise<ChallengeBot[]> {
    const client = requireClient();
    const { data, error } = await client
      .from('challenge_bots')
      .select('id, challenge_id, name, fitness_level, role')
      .eq('challenge_id', challengeId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      id: row.id,
      challengeId: row.challenge_id,
      name: row.name,
      fitnessLevel: row.fitness_level,
      role: (row.role as HuntRole | null) ?? null,
    }));
  },

  async getLeaderboard(challengeId: string, asOfDay?: string): Promise<LeaderboardEntry[]> {
    const client = requireClient();
    // Aggregated client-side rather than via a Postgres view/RPC — the
    // per-challenge row count is small (one row per participant per day),
    // and keeping the aggregation in JS means the schema stays plain
    // tables, nothing to keep in sync on top of it.
    let query = client
      .from('progress_snapshots')
      .select('user_id, steps, distance_mi, profiles(name, initials)')
      .eq('challenge_id', challengeId);
    if (asOfDay) query = query.lte('day', asOfDay);
    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const totals = new Map<string, LeaderboardEntry>();
    for (const row of data ?? []) {
      const profile = row.profiles as unknown as { name: string; initials: string } | null;
      const existing = totals.get(row.user_id);
      if (existing) {
        existing.totalSteps += row.steps;
        existing.totalDistanceMi += Number(row.distance_mi);
      } else {
        totals.set(row.user_id, {
          userId: row.user_id,
          name: profile?.name ?? 'Someone',
          initials: profile?.initials ?? '?',
          totalSteps: row.steps,
          totalDistanceMi: Number(row.distance_mi),
        });
      }
    }
    return Array.from(totals.values()).sort((a, b) => b.totalSteps - a.totalSteps);
  },

  async createChallenge({
    name,
    kind,
    durationDays,
    dailyGoalSteps,
    scoringMethod,
    creatorRole,
    bots,
    headStartDays,
    distanceGoalMi,
    distanceGoalSteps,
    distanceGoalUnit,
  }: CreateChallengeInput): Promise<Challenge> {
    const client = requireClient();
    const userId = await requireUserId();
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + durationDays * 86_400_000);

    const { data, error } = await client
      .from('challenges')
      .insert({
        name,
        kind,
        created_by: userId,
        duration_days: durationDays,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        daily_goal_steps: dailyGoalSteps ?? null,
        scoring_method: scoringMethod ?? null,
        head_start_days: headStartDays ?? null,
        distance_goal_mi: distanceGoalMi ?? null,
        distance_goal_steps: distanceGoalSteps ?? null,
        distance_goal_unit: distanceGoalUnit ?? null,
      })
      .select(CHALLENGE_COLUMNS)
      .single();
    if (error) throw new Error(error.message);

    // The creator is a participant too — nothing else adds this row
    // automatically.
    const { error: joinError } = await client
      .from('challenge_participants')
      .insert({ challenge_id: data.id, user_id: userId, role: creatorRole ?? null });
    if (joinError) throw new Error(joinError.message);

    if (bots && bots.length > 0) {
      const { error: botsError } = await client.from('challenge_bots').insert(
        bots.map((b) => ({
          challenge_id: data.id,
          name: b.name,
          fitness_level: b.fitnessLevel,
          role: b.role ?? null,
        })),
      );
      if (botsError) throw new Error(botsError.message);
    }

    return rowToChallenge(data);
  },

  async recordProgress(challengeId: string, steps: number, distanceMi: number, day?: string): Promise<void> {
    const client = requireClient();
    const userId = await requireUserId();
    // Local calendar day, not `.toISOString().slice(0, 10)` — that's UTC,
    // and ChallengeDetailScreen's device-sync backfill keys every day by
    // the *local* calendar (matching HealthKit/Health Connect's own
    // day-bucketing). A UTC default here would silently write a second,
    // differently-keyed row for "today" whenever local and UTC dates
    // differ, and getLeaderboard() sums every row with no dedup by real
    // calendar day — so the two would double-count the same day's steps.
    const resolvedDay = day ?? localDateKey(new Date());
    const { error } = await client
      .from('progress_snapshots')
      .upsert(
        { challenge_id: challengeId, user_id: userId, day: resolvedDay, steps, distance_mi: distanceMi },
        { onConflict: 'challenge_id,user_id,day' },
      );
    if (error) throw new Error(error.message);
  },

  async deleteChallenge(challengeId: string): Promise<void> {
    const client = requireClient();
    const { error } = await client.from('challenges').delete().eq('id', challengeId);
    if (error) throw new Error(error.message);
  },

  async getHighlightedChallenge(): Promise<Challenge | null> {
    const client = requireClient();
    const userId = await requireUserId();
    const { data, error } = await client
      .from('challenge_participants')
      .select(`challenges!inner(${CHALLENGE_COLUMNS})`)
      .eq('user_id', userId)
      .eq('highlighted', true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return rowToChallenge(data.challenges as unknown as ChallengeRow);
  },

  async setHighlighted(challengeId: string, highlighted: boolean): Promise<void> {
    const client = requireClient();
    const userId = await requireUserId();
    if (highlighted) {
      // Only one challenge can be highlighted at a time — clear whatever
      // this user had highlighted before (if anything) first.
      const { error: clearError } = await client
        .from('challenge_participants')
        .update({ highlighted: false })
        .eq('user_id', userId)
        .eq('highlighted', true);
      if (clearError) throw new Error(clearError.message);
    }
    const { error } = await client
      .from('challenge_participants')
      .update({ highlighted })
      .eq('challenge_id', challengeId)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
  },

  async listMyChallengeInvites(): Promise<ChallengeInvite[]> {
    const client = requireClient();
    const userId = await requireUserId();
    const { data, error } = await client
      .from('challenge_invites')
      .select(
        'id, challenges(id, name, kind, duration_days), ' +
          'inviter:profiles!challenge_invites_inviter_id_fkey(name), role',
      )
      .eq('invitee_id', userId);
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as ChallengeInviteRow[])
      .filter((row) => row.challenges)
      .map((row) => ({
        id: row.id,
        challengeId: row.challenges!.id,
        challengeName: row.challenges!.name,
        challengeKind: row.challenges!.kind,
        durationDays: row.challenges!.duration_days,
        inviterName: row.inviter?.name ?? 'Someone',
        role: row.role,
      }));
  },

  async inviteFriendToChallenge(challengeId: string, friendUserId: string, role?: HuntRole): Promise<void> {
    const client = requireClient();
    const userId = await requireUserId();
    const { data, error } = await client
      .from('challenge_invites')
      .insert({ challenge_id: challengeId, inviter_id: userId, invitee_id: friendUserId, role: role ?? null })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505') throw new Error('Already invited.');
      throw new Error(error.message);
    }
    // Best-effort, same reasoning CreateScreen's own invite calls use
    // Promise.allSettled for: the invite itself already saved
    // successfully by this point, so a failed email (no RESEND_API_KEY
    // set, Resend rejecting an unverified domain, whatever) shouldn't
    // read as "could not invite that friend" — the in-app invite card
    // still works regardless of whether this email ever arrives.
    client.functions.invoke('send-challenge-invite-email', { body: { inviteId: data.id } }).catch(() => {});
  },

  async acceptChallengeInvite(inviteId: string): Promise<void> {
    const client = requireClient();
    const userId = await requireUserId();
    const { data: invite, error: fetchError } = await client
      .from('challenge_invites')
      .select('challenge_id, role')
      .eq('id', inviteId)
      .single();
    if (fetchError) throw new Error(fetchError.message);

    // A plain insert, not an upsert: `.upsert(..., { ignoreDuplicates })`
    // compiles to `INSERT ... ON CONFLICT DO NOTHING`, and Postgres RLS
    // requires the executing role to satisfy the table's SELECT policy
    // for the conflict-arbiter check itself — even when no conflict
    // actually exists. The invitee accepting for the first time isn't a
    // participant yet (that's exactly what this insert is trying to
    // make them), so "Participants can view each other" always returns
    // false for them, and the whole statement gets rejected as an RLS
    // violation before it ever gets to check for a real conflict. A
    // plain insert has no such requirement. A retry after a failed
    // delete below (already joined, invite row still there) instead
    // hits challenge_participants' own unique(challenge_id, user_id)
    // constraint (Postgres code 23505) — caught and treated as success,
    // same reasoning inviteFriendToChallenge already uses for "Already
    // invited."
    const { error: joinError } = await client
      .from('challenge_participants')
      .insert({ challenge_id: invite.challenge_id, user_id: userId, role: invite.role ?? null });
    if (joinError && joinError.code !== '23505') throw new Error(joinError.message);

    const { error: deleteError } = await client.from('challenge_invites').delete().eq('id', inviteId);
    if (deleteError) throw new Error(deleteError.message);
  },

  async declineChallengeInvite(inviteId: string): Promise<void> {
    const client = requireClient();
    const { error } = await client.from('challenge_invites').delete().eq('id', inviteId);
    if (error) throw new Error(error.message);
  },

  async markCaught(challengeId: string): Promise<void> {
    const client = requireClient();
    const userId = await requireUserId();
    // No `.eq('role', 'hunted')` guard here — going from 'zombie' to
    // 'zombie' is a no-op write either way, and the caller
    // (ChallengeDetailScreen) already only calls this once it's seen
    // the board compute 'zombie' for this exact user.
    const { error } = await client
      .from('challenge_participants')
      .update({ role: 'zombie' })
      .eq('challenge_id', challengeId)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
  },
};
