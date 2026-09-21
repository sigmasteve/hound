// The same real-world workout can land in HealthKit/Health Connect as
// two separate records when a paired wearable (Apple Watch, Wear OS)
// and a companion app (e.g. a Peloton-style app) each write their own
// copy of the same session — a known, unresolved gap in both platforms'
// own APIs (even Apple's first-party Fitness app shows the same
// duplicates), not something either provider's query filters out on its
// own. Each provider maps its raw records into the minimal shape below
// and this picks one workout per overlapping-time, same-activity-type
// cluster, preferring whichever copy carries richer data (distance/
// energy present) as the tiebreaker.
//
// This is a heuristic, not an exact match: two genuinely back-to-back
// sessions that happen to touch at one instant would incorrectly merge,
// and two real duplicates whose start/end times don't quite overlap (one
// source stops a few seconds later than the other) would incorrectly
// survive as two. Good enough for the common paired-source case this
// exists for, not a guarantee for every edge case.

export interface DedupeCandidate {
  // Whatever uniquely identifies "same kind of workout" for that
  // platform — HealthKit's own WorkoutActivityType enum (stringified),
  // Health Connect's exerciseType.
  activityKey: string;
  startMs: number;
  endMs: number;
  // Higher wins when two candidates overlap — not used to rank
  // non-overlapping workouts against each other.
  richness: number;
}

export function pickNonOverlapping<T>(items: readonly T[], keyOf: (item: T) => DedupeCandidate): T[] {
  const withKeys = items
    .map((item) => ({ item, key: keyOf(item) }))
    .sort((a, b) => a.key.startMs - b.key.startMs);

  const kept: { item: T; key: DedupeCandidate }[] = [];
  for (const candidate of withKeys) {
    const overlapIdx = kept.findIndex(
      (k) =>
        k.key.activityKey === candidate.key.activityKey &&
        candidate.key.startMs < k.key.endMs &&
        k.key.startMs < candidate.key.endMs,
    );
    if (overlapIdx === -1) {
      kept.push(candidate);
    } else if (candidate.key.richness > kept[overlapIdx].key.richness) {
      kept[overlapIdx] = candidate;
    }
  }
  return kept.map((k) => k.item);
}
