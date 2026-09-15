import { supabase } from '../lib/supabase';
import type {
  Challenge,
  ChallengeBot,
  ChallengesProvider,
  CreateChallengeInput,
  HuntRole,
  LeaderboardEntry,
  Participant,
} from './types';

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

async function requireUserId(): Promise<string> {
  const { data } = await requireClient().auth.getUser();
  if (!data.user) throw new Error('Sign in to do that.');
  return data.user.id;
}

const CHALLENGE_COLUMNS = 'id, name, kind, created_by, duration_days, starts_at, ends_at, daily_goal_steps, scoring_method';

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
      .select('user_id, role, profiles(name, initials)')
      .eq('challenge_id', challengeId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => {
      const profile = row.profiles as unknown as { name: string; initials: string } | null;
      return {
        userId: row.user_id,
        name: profile?.name ?? 'Someone',
        initials: profile?.initials ?? '?',
        role: (row.role as HuntRole | null) ?? null,
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

  async getLeaderboard(challengeId: string): Promise<LeaderboardEntry[]> {
    const client = requireClient();
    // Aggregated client-side rather than via a Postgres view/RPC — the
    // per-challenge row count is small (one row per participant per day),
    // and keeping the aggregation in JS means the schema stays plain
    // tables, nothing to keep in sync on top of it.
    const { data, error } = await client
      .from('progress_snapshots')
      .select('user_id, steps, distance_mi, profiles(name, initials)')
      .eq('challenge_id', challengeId);
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

  async recordProgress(challengeId: string, steps: number, distanceMi: number): Promise<void> {
    const client = requireClient();
    const userId = await requireUserId();
    const day = new Date().toISOString().slice(0, 10);
    const { error } = await client
      .from('progress_snapshots')
      .upsert(
        { challenge_id: challengeId, user_id: userId, day, steps, distance_mi: distanceMi },
        { onConflict: 'challenge_id,user_id,day' },
      );
    if (error) throw new Error(error.message);
  },
};
