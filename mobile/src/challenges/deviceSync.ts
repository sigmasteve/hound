import { supabaseChallengesProvider } from './supabaseChallenges';
import { usesDeviceSteps, usesWorkoutDistance } from './scoring';
import { classifyWorkout, DEFAULT_BINGO_CARD_TYPE, type BingoCategory } from './bingo';
import { recordBingoProgress } from './bingoApi';
import type { Challenge } from './types';
import type { HealthProvider, WorkoutSample } from '../health/types';

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Backfills one challenge's entire progress from real device history —
// every calendar day from when it started through today, not just
// today — using the same upsert-by-day recordProgress() the manual form
// uses, just filled in from the device instead of typed in. Re-running
// this on every sync is deliberate and harmless (it's an upsert): it
// catches up a challenge someone joined after it started, or picks back
// up correctly after a few days of not opening the app, without a
// separate "first ever sync" code path. Which number depends on what
// this challenge is scored on: a plain step count, or distance summed
// from logged workouts. 'gps_distance' trusts WorkoutSample.isOutdoor
// when a platform provides it (iOS, from HealthKit's own workout
// metadata) and only falls back to guessing from the workout's name
// when it doesn't (Android, or an iOS workout with no indoor/outdoor
// metadata at all) — that fallback still means a treadmill session or a
// phone-in-a-drawer walk can slip through if its name happens to match,
// a real limitation on the platforms/workouts that don't carry the real
// signal, not a hidden bug.
//
// Shared by ChallengeDetailScreen (syncs the one challenge currently
// open) and HomeScreen (syncs every active device-scored challenge on
// every load) — see HomeScreen's own comment on why the latter exists:
// progress used to only ever reach the server as a side effect of
// opening that exact challenge's own detail screen, so a participant
// who joined but never opened it individually stayed at 0 forever
// despite their device logging real steps the whole time.
export async function syncChallengeProgressFromDevice(challenge: Challenge, health: HealthProvider): Promise<void> {
  if (!usesDeviceSteps(challenge) && !usesWorkoutDistance(challenge)) return;
  try {
    const since = new Date(challenge.startsAt);
    // Local-calendar day keys throughout — startDayKey/endCap have to
    // compare against dateKey()'s local dates the same way todayKey
    // does, or a day just outside the challenge's real range can slip
    // through (or a real one get excluded) at the UTC/local boundary.
    const startDayKey = dateKey(since);
    const endCap = dateKey(new Date(challenge.endsAt));
    const todayKey = dateKey(new Date());

    if (usesWorkoutDistance(challenge)) {
      // Enough of a lookback to plausibly cover the whole challenge —
      // getRecentWorkouts() takes a count, not a date range, so this
      // over-fetches slightly and filters client-side instead.
      const workouts = await health.getRecentWorkouts(200);
      // A precise timestamp comparison, deliberately — unlike the steps
      // branch below (which only ever gets one cumulative total per
      // calendar day from the OS, so it has no finer choice than a day
      // boundary), a workout carries its own real start time, so
      // `since` itself is exactly what CreateScreen's "Starts" picker
      // set it to: start of today (retroactive — includes a workout
      // logged before the challenge existed, same day), this exact
      // moment (excludes it), or start of tomorrow (excludes all of
      // today, even a workout logged after creating the challenge).
      const inRange = workouts.filter((w) => w.when >= since);
      // isOutdoor is a real per-workout signal where the platform can give
      // one (currently iOS only, from HealthKit's own indoor/outdoor
      // metadata — see health/types.ts) — trust it definitively, true or
      // false, over the name guess. `??` is exactly right here: it only
      // falls through to the name check when isOutdoor is undefined
      // ("platform doesn't know"), not when it's false ("platform knows
      // this was indoor").
      const relevant =
        challenge.scoringMethod === 'gps_distance'
          ? inRange.filter((w) => w.isOutdoor ?? /run|walk|jog|hike/i.test(w.name))
          : inRange;

      const byDay = new Map<string, number>();
      for (const w of relevant) {
        const key = dateKey(w.when);
        if (key > endCap) continue;
        byDay.set(key, (byDay.get(key) ?? 0) + (w.distanceMi ?? 0));
      }
      // Today always gets an explicit (possibly zero) row, same as
      // before this backfilled past days too — otherwise a day with no
      // matching workout yet would just never get synced at all.
      if (!byDay.has(todayKey) && todayKey <= endCap) byDay.set(todayKey, 0);

      await Promise.all(
        Array.from(byDay.entries()).map(([day, distanceMi]) =>
          supabaseChallengesProvider.recordProgress(challenge.id, 0, distanceMi, day),
        ),
      );
    } else {
      // getDailyStepsSince(since) is asked for history back to the
      // challenge's start, but still gets clamped to
      // [startDayKey, endCap] here rather than trusted as-is — a
      // provider can hand back a bucket just outside that range (a
      // day before the challenge existed, one past its end) and
      // that's never real progress for it. A past day with no actual
      // device data (0 steps and 0 distance) is dropped rather than
      // written as an explicit zero — that's "nothing recorded", not
      // "recorded a zero" — except today, which always gets a row so
      // the screen doesn't look unsynced before you've taken a step.
      const daily = (await health.getDailyStepsSince(since)).filter(
        (d) =>
          d.date >= startDayKey &&
          d.date <= endCap &&
          (d.date === todayKey || d.steps > 0 || d.distanceMi > 0),
      );
      await Promise.all(
        daily.map((d) => supabaseChallengesProvider.recordProgress(challenge.id, d.steps, d.distanceMi, d.date)),
      );
    }
  } catch {
    // Best-effort — every caller of this already treats a sync failure
    // as silent (ChallengeDetailScreen's own screen has no "Your
    // progress" card left to surface an error on; HomeScreen's own load
    // already swallows failures the same way for its other fetches).
  }
}

// Bingo's own sync path — deliberately separate from
// syncChallengeProgressFromDevice above rather than folded into
// usesWorkoutDistance: a bingo challenge isn't steps- or
// distance-ranked at all (see scoring.ts), it just needs to know which
// of its 9 categories (bingo.ts's BINGO_CARD_CATEGORIES, keyed by the
// challenge's own bingoCardType) each recent workout classifies into.
// Shared by the same two call sites as the function above
// (ChallengeDetailScreen's syncFromDevice, HomeScreen's per-active-
// challenge sync loop).
export async function syncBingoProgressFromDevice(challenge: Challenge, health: HealthProvider): Promise<void> {
  if (challenge.kind !== 'bingo') return;
  try {
    const cardType = challenge.bingoCardType ?? DEFAULT_BINGO_CARD_TYPE;
    const since = new Date(challenge.startsAt);
    const endsAt = new Date(challenge.endsAt);
    const workouts = await health.getRecentWorkouts(200);
    const inRange = workouts.filter((w) => w.when >= since && w.when <= endsAt);
    // First match per category wins — which specific workout gets
    // credited only matters for the "linked to <name>" caption a filled
    // square shows (see BingoProgressRow), not for whether the square is
    // filled at all.
    const byCategory = new Map<BingoCategory, WorkoutSample>();
    for (const w of inRange) {
      const category = classifyWorkout(w.name, cardType);
      if (!byCategory.has(category)) byCategory.set(category, w);
    }
    // Re-attempts every category found in this window on every sync, even
    // ones already filled — recordBingoProgress's own upsert makes an
    // already-filled square a cheap no-op (and, critically, never
    // overwrites a manual link — see that function's own comment), same
    // "re-running this is deliberate and harmless" reasoning the
    // steps/distance sync above already relies on, rather than tracking
    // which categories this device has already reported.
    await Promise.all(
      Array.from(byCategory.entries()).map(([category, w]) =>
        recordBingoProgress(challenge.id, category, 'auto', { id: w.id, name: w.name, when: w.when }),
      ),
    );
  } catch {
    // Best-effort, same reasoning as syncChallengeProgressFromDevice's own
    // catch above.
  }
}
