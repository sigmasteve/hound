import { supabase } from '../lib/supabase';

// The server side of a step challenge's story (0233): the creator's
// options, everyone's daily steps (progress_snapshots, which
// participants can read), the "who saw what" log, and Admin.

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export interface StepOptions {
  rivals: boolean;
  bounties: boolean;
  blackout: boolean;
}

export const DEFAULT_STEP_OPTIONS: StepOptions = { rivals: true, bounties: true, blackout: false };

// Before 0233 has run, the defaults.
export async function getStepOptions(challengeId: string): Promise<StepOptions> {
  const { data, error } = await requireClient()
    .from('challenges')
    .select('step_rivals, step_bounties, blackout_last_day')
    .eq('id', challengeId)
    .maybeSingle();
  if (error || !data) return DEFAULT_STEP_OPTIONS;
  const d = data as { step_rivals?: boolean; step_bounties?: boolean; blackout_last_day?: boolean };
  return { rivals: d.step_rivals !== false, bounties: d.step_bounties !== false, blackout: !!d.blackout_last_day };
}

export interface DailyRow {
  userId: string;
  day: string;
  steps: number;
  distanceMi: number;
}

// Everyone's steps, day by day, a page at a time (a long challenge goes
// past one read's 1,000 rows).
export async function getDailySteps(challengeId: string): Promise<DailyRow[]> {
  const client = requireClient();
  const out: DailyRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from('progress_snapshots')
      .select('user_id, day, steps, distance_mi')
      .eq('challenge_id', challengeId)
      .order('day')
      .order('user_id')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { user_id: string; day: string; steps: number; distance_mi: number | string }[])
      out.push({ userId: r.user_id, day: r.day, steps: r.steps ?? 0, distanceMi: Number(r.distance_mi ?? 0) });
    if (!data || data.length < 1000) break;
  }
  return out;
}

export type StoryKind = 'race' | 'list' | 'replay' | 'finish' | 'trail' | 'rival_beaten' | 'bounty_star' | 'checkpoint';

// Once a day per kind (the server keeps it so); never in the way.
const logged = new Set<string>();
export function logStepStory(challengeId: string, kind: StoryKind): void {
  const key = `${challengeId}:${kind}:${new Date().toDateString()}`;
  if (logged.has(key) || !supabase) return;
  logged.add(key);
  supabase
    .rpc('log_step_story', { p_challenge_id: challengeId, p_kind: kind })
    .then(() => {}, () => {});
}

export interface StepStoryOverview {
  liveSteps: number;
  livePools: number;
  liveBlackout: number;
  liveNoRivals: number;
  liveNoBounties: number;
  people7d: number;
  racePeople7d: number;
  raceDays7d: number;
  listPeople7d: number;
  replayPeople7d: number;
  replays7d: number;
  finishPeople7d: number;
  trailPeople7d: number;
  rivalsBeaten7d: number;
  bountyStars7d: number;
  checkpoints7d: number;
}

export async function getStepStoryOverview(): Promise<StepStoryOverview> {
  const { data, error } = await requireClient().rpc('admin_step_story_overview');
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as Record<string, unknown>;
  const n = (k: string) => Number(d[k] ?? 0);
  return {
    liveSteps: n('live_steps'),
    livePools: n('live_pools'),
    liveBlackout: n('live_blackout'),
    liveNoRivals: n('live_no_rivals'),
    liveNoBounties: n('live_no_bounties'),
    people7d: n('people_7d'),
    racePeople7d: n('race_people_7d'),
    raceDays7d: n('race_days_7d'),
    listPeople7d: n('list_people_7d'),
    replayPeople7d: n('replay_people_7d'),
    replays7d: n('replays_7d'),
    finishPeople7d: n('finish_people_7d'),
    trailPeople7d: n('trail_people_7d'),
    rivalsBeaten7d: n('rivals_beaten_7d'),
    bountyStars7d: n('bounty_stars_7d'),
    checkpoints7d: n('checkpoints_7d'),
  };
}

export function stepStorySummary(o: StepStoryOverview): string {
  return o.racePeople7d > 0 ? `${o.racePeople7d} watched the race this week` : `${o.liveSteps} Most steps on now`;
}
