import type { Challenge } from './types';

// A 'steps' challenge always auto-syncs from the device; a 'hunt' only
// does when its creator picked 'device_steps' as what counts (see
// CreateScreen's "What counts" picker) — every other kind/scoring
// combination still needs the manual form (ChallengeDetailScreen) or
// falls back to ranking by steps regardless (HomeScreen's leaderboard
// card, which never writes progress itself).
export function usesDeviceSteps(challenge: Challenge): boolean {
  return challenge.kind === 'steps' || (challenge.kind === 'hunt' && challenge.scoringMethod === 'device_steps');
}

// A hunt scored on 'gps_distance' or 'any_workout' auto-syncs from
// today's logged workouts instead of steps — see
// ChallengeDetailScreen.tsx's syncFromDevice for exactly how the two
// differ. Everyone's totalSteps is 0 for a challenge scored this way, so
// anything ranking its board needs to sort by distance instead.
export function usesWorkoutDistance(challenge: Challenge): boolean {
  return challenge.kind === 'hunt' && (challenge.scoringMethod === 'gps_distance' || challenge.scoringMethod === 'any_workout');
}

export function boardSortFor(challenge: Challenge): 'steps' | 'distance' {
  return usesWorkoutDistance(challenge) ? 'distance' : 'steps';
}
