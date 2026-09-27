import { supabase } from '../lib/supabase';
import { isSeventyFiveDayComplete, type SeventyFiveCheckin } from './seventyFive';

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

async function requireUserId(): Promise<string> {
  const { data } = await requireClient().auth.getUser();
  if (!data.user) throw new Error('Sign in to do that.');
  return data.user.id;
}

// Deliberately duplicated rather than imported from seventyFive.ts (which
// doesn't export it — same "pure compute file stays dependency-free"
// shape streak.ts/streakApi.ts already split into two files for) — see
// recordProgress's own identical comment in supabaseChallenges.ts for why
// this has to be the local calendar day, not UTC.
function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Every checkin row logged for this challenge, across every participant
// — 0062_seventyfive.sql's own "Participants can view seventyfive
// checkins" policy is participant-wide, same as progress_snapshots',
// since the whole point of a shared accountability challenge is seeing
// how everyone else is doing.
export async function listSeventyFiveCheckins(challengeId: string): Promise<SeventyFiveCheckin[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('seventyfive_checkins')
    .select('user_id, day, workout1_done, workout2_outdoor_done, diet_done, water_done, reading_done, photo_done')
    .eq('challenge_id', challengeId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    userId: row.user_id,
    day: row.day as string,
    workout1Done: row.workout1_done,
    workout2OutdoorDone: row.workout2_outdoor_done,
    dietDone: row.diet_done,
    waterDone: row.water_done,
    readingDone: row.reading_done,
    photoDone: row.photo_done,
  }));
}

// Same shape as streakApi.ts's own listParticipantJoinDates — duplicated
// rather than imported across kind-specific api files, matching this
// codebase's existing "each kind's own api file is self-contained"
// convention (bingoApi.ts/streakApi.ts don't import from each other
// either). When someone joined (not the challenge's own start) is where
// their own streak clock starts, so joining a week in doesn't
// retroactively reset them for days before they were ever a participant.
export async function listSeventyFiveJoinDates(challengeId: string): Promise<Map<string, Date>> {
  const client = requireClient();
  const { data, error } = await client
    .from('challenge_participants')
    .select('user_id, joined_at')
    .eq('challenge_id', challengeId);
  if (error) throw new Error(error.message);
  const map = new Map<string, Date>();
  for (const row of data ?? []) map.set(row.user_id, new Date(row.joined_at as string));
  return map;
}

// A single-row lookup for "have I finished today's checklist" — unlike
// listSeventyFiveCheckins above, this never fetches every participant's
// whole history, just the caller's own row for today. Built for the
// Home screen's pending-actions aggregator, which needs this answer for
// every active 75 Day Challenge the person is in, not the full detail
// screen's per-participant breakdown. No row yet today means trivially
// incomplete, not an error.
export async function isMySeventyFiveTodayComplete(challengeId: string, userId: string): Promise<boolean> {
  const client = requireClient();
  const { data, error } = await client
    .from('seventyfive_checkins')
    .select('workout1_done, workout2_outdoor_done, diet_done, water_done, reading_done, photo_done')
    .eq('challenge_id', challengeId)
    .eq('user_id', userId)
    .eq('day', localDateKey(new Date()))
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return false;
  return isSeventyFiveDayComplete({
    workout1Done: data.workout1_done,
    workout2OutdoorDone: data.workout2_outdoor_done,
    dietDone: data.diet_done,
    waterDone: data.water_done,
    readingDone: data.reading_done,
    photoDone: data.photo_done,
  });
}

export type SelfReportItem = 'diet' | 'water' | 'reading' | 'photo';

const SELF_REPORT_COLUMN: Record<SelfReportItem, string> = {
  diet: 'diet_done',
  water: 'water_done',
  reading: 'reading_done',
  photo: 'photo_done',
};

// Only ever touches the one column named by `item`, plus the row's own
// key — the upsert payload never includes workout1_done/
// workout2_outdoor_done, so this can't clobber whatever
// syncSeventyFiveFromDevice already wrote (or will write later) for the
// same day. Defaults to today; a past day's checklist isn't editable
// (see ChallengeDetailScreen's own checklist card, today-only by design).
export async function setSelfReportCheckin(
  challengeId: string,
  item: SelfReportItem,
  done: boolean,
  day?: string,
): Promise<void> {
  const client = requireClient();
  const userId = await requireUserId();
  const resolvedDay = day ?? localDateKey(new Date());
  const { error } = await client
    .from('seventyfive_checkins')
    .upsert(
      { challenge_id: challengeId, user_id: userId, day: resolvedDay, [SELF_REPORT_COLUMN[item]]: done },
      { onConflict: 'challenge_id,user_id,day' },
    );
  if (error) throw new Error(error.message);
}

// The device-synced half — only ever touches workout1_done/
// workout2_outdoor_done, same disjoint-columns reasoning as
// setSelfReportCheckin above, just in the other direction.
export async function recordSeventyFiveWorkouts(
  challengeId: string,
  day: string,
  workout1Done: boolean,
  workout2OutdoorDone: boolean,
): Promise<void> {
  const client = requireClient();
  const userId = await requireUserId();
  const { error } = await client
    .from('seventyfive_checkins')
    .upsert(
      {
        challenge_id: challengeId,
        user_id: userId,
        day,
        workout1_done: workout1Done,
        workout2_outdoor_done: workout2OutdoorDone,
      },
      { onConflict: 'challenge_id,user_id,day' },
    );
  if (error) throw new Error(error.message);
}
