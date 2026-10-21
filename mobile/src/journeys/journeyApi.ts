import { supabase } from '../lib/supabase';
import { localDayKey } from '../goals/goals';
import type { Course } from './courses';

// Journeys and daily miles (0120_journeys.sql). Every call throws the
// server's message on failure.

export interface MyJourney {
  id: string;
  courseId: string;
  courseName: string;
  courseMiles: number;
  startedOn: string;
  countAllMiles: boolean;
  finishedAt: string | null;
  miles: number;
  finishedCount: number;
}

export interface FriendOnCourse {
  userId: string;
  name: string;
  initials: string;
  frameId: string | null;
  backgroundId: string | null;
  iconId: string | null;
  miles: number;
  finishedAt: string | null;
}

export interface DailyMiles {
  day: string;
  workoutMi: number;
  allMi: number;
}

function client() {
  if (!supabase) throw new Error('Journeys need a connection to Hound.');
  return supabase;
}

// Your current journey, or the one you just finished; null for none (or
// before 0120 has run).
export async function getMyJourney(): Promise<MyJourney | null> {
  const { data, error } = await client().rpc('my_journey');
  if (error) {
    if (error.message.includes('my_journey')) return null;
    throw new Error(error.message);
  }
  const r = (data as any[] | null)?.[0];
  if (!r) return null;
  return {
    id: r.id,
    courseId: r.course_id,
    courseName: r.course_name,
    courseMiles: Number(r.course_miles),
    startedOn: r.started_on,
    countAllMiles: r.count_all_miles,
    finishedAt: r.finished_at,
    miles: Number(r.miles),
    finishedCount: r.finished_count ?? 0,
  };
}

export async function startJourney(course: Course): Promise<void> {
  const { error } = await client().rpc('start_journey', {
    p_course_id: course.id,
    p_course_name: course.name,
    p_course_miles: course.miles,
    p_local_date: localDayKey(new Date()),
  });
  if (error) throw new Error(error.message);
}

export async function endJourney(): Promise<void> {
  const { error } = await client().rpc('end_journey');
  if (error) throw new Error(error.message);
}

export async function setJourneyCountAll(countAll: boolean): Promise<void> {
  const { error } = await client().rpc('set_journey_count_all', { p_count_all: countAll });
  if (error) throw new Error(error.message);
}

// True only on the call that finishes your journey; the server tells
// your friends.
export async function checkJourneyFinish(): Promise<boolean> {
  const { data, error } = await client().rpc('check_journey_finish');
  if (error) throw new Error(error.message);
  return data === true;
}

export async function friendsOnCourse(courseId: string): Promise<FriendOnCourse[]> {
  const { data, error } = await client().rpc('friends_on_course', { p_course_id: courseId });
  if (error) throw new Error(error.message);
  return ((data as any[]) ?? []).map((r) => ({
    userId: r.user_id,
    name: r.name,
    initials: r.initials ?? '?',
    frameId: r.frame_id,
    backgroundId: r.background_id,
    iconId: r.icon_id,
    miles: Number(r.miles),
    finishedAt: r.finished_at,
  }));
}

// How many friends are on each course right now, by course id.
export async function friendsCourseCounts(): Promise<Map<string, number>> {
  const { data, error } = await client().rpc('friends_course_counts');
  if (error) throw new Error(error.message);
  return new Map(((data as any[]) ?? []).map((r) => [r.course_id as string, Number(r.friends)]));
}

export async function recordDailyMiles(userId: string, days: DailyMiles[]): Promise<void> {
  if (days.length === 0) return;
  const { error } = await client()
    .from('daily_miles')
    .upsert(
      days.map((d) => ({
        user_id: userId,
        day: d.day,
        workout_mi: Math.min(150, Math.round(d.workoutMi * 100) / 100),
        all_mi: Math.min(150, Math.round(d.allMi * 100) / 100),
      })),
      { onConflict: 'user_id,day' },
    );
  if (error) throw new Error(error.message);
}

// ── Journey challenges ───────────────────────────────────────────────

// Where you stand on a Journey challenge you're in (0122_journey_challenges.sql):
// your place by miles, how many are ahead and behind, how many have
// reached the end, and the leader's miles. Null if you're not in it.
export interface JourneyStanding {
  rank: number;
  total: number;
  ahead: number;
  behind: number;
  finished: number;
  miles: number;
  leaderMiles: number;
}

export async function journeyStanding(challengeId: string): Promise<JourneyStanding | null> {
  const { data, error } = await client().rpc('journey_standing', { p_challenge_id: challengeId });
  if (error) throw new Error(error.message);
  const r = (data as any[] | null)?.[0];
  if (!r) return null;
  return {
    rank: r.rank,
    total: r.total,
    ahead: r.ahead,
    behind: r.behind,
    finished: r.finished,
    miles: Number(r.miles),
    leaderMiles: Number(r.leader_miles),
  };
}
