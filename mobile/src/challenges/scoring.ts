import type { Challenge } from './types';

// A 'steps' challenge always auto-syncs from the device; a 'hunt' only
// does when its creator picked 'device_steps' as what counts (see
// CreateScreen's "What counts" picker); a 'distance' pool does when its
// group target is steps (CreateScreen.tsx's unit picker) — the miles
// case is usesWorkoutDistance below instead. Every other kind/scoring
// combination still needs the manual form (ChallengeDetailScreen) or
// falls back to ranking by steps regardless (HomeScreen's leaderboard
// card, which never writes progress itself).
export function usesDeviceSteps(challenge: Challenge): boolean {
  return (
    challenge.kind === 'steps' ||
    (challenge.kind === 'hunt' && challenge.scoringMethod === 'device_steps') ||
    (challenge.kind === 'distance' && challenge.distanceGoalUnit === 'steps')
  );
}

// A hunt scored on 'gps_distance' or 'any_workout', or a 'distance' pool
// whose group target is miles, auto-syncs from today's logged workouts
// instead of steps — see ChallengeDetailScreen.tsx's syncFromDevice for
// exactly how the two hunt scoring methods differ (a pool has no such
// distinction, so it's treated like 'any_workout': every logged workout
// counts, not just ones named like a run or walk). Everyone's totalSteps
// is 0 for a challenge scored this way, so anything ranking its board
// needs to sort by distance instead. Deliberately excludes a pool with
// distanceGoalUnit === null (every pool created before the unit picker
// existed) — that legacy case keeps its existing manual-entry,
// ranked-by-steps behavior rather than silently changing under it.
export function usesWorkoutDistance(challenge: Challenge): boolean {
  return (
    (challenge.kind === 'hunt' && (challenge.scoringMethod === 'gps_distance' || challenge.scoringMethod === 'any_workout')) ||
    (challenge.kind === 'distance' && challenge.distanceGoalUnit === 'miles')
  );
}

// Whether a challenge's own "what matters" number is miles rather than
// steps — a workout-distance hunt (above), or a Distance Pool whose
// creator picked "Miles" for its group target (CreateScreen.tsx). A
// Distance Pool with a "Steps" target, or one created before
// 0013_distance_pool_unit.sql existed, still ranks by steps like every
// other kind — see distanceGoalUnit on Challenge.
export function usesDistanceRanking(challenge: Challenge): boolean {
  return (
    usesWorkoutDistance(challenge) ||
    (challenge.kind === 'distance' && challenge.distanceGoalUnit === 'miles' && challenge.distanceGoalMi != null)
  );
}

export function boardSortFor(challenge: Challenge): 'steps' | 'distance' {
  return usesDistanceRanking(challenge) ? 'distance' : 'steps';
}
