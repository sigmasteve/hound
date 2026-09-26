-- Hound: fixes the anti-double-link guard 0053_bingo_manual_link.sql
-- added — it keyed uniqueness on workout_at (a timestamp), which turned
-- out not to be the stable thing it looked like.
--
-- Real bug hit in the field: the same real gym session got auto-classified
-- into 'strength' and then successfully manually linked to 'swim' too —
-- the unique index on workout_at should have rejected the second insert,
-- but didn't. workout_at is *derived* platform data (HealthKit's own
-- w.startDate, Health Connect's own r.startTime), re-read fresh on every
-- separate getRecentWorkouts() call — nothing about either platform's own
-- API promises that a native health bridge serializes the exact same
-- instant to a bit-identical value across two independent calls, and nothing
-- rules out pickNonOverlapping's own dedup (see dedupeWorkouts.ts) resolving
-- a Watch+phone duplicate pair to a different one of the two records on a
-- later fetch than an earlier one. Either way, two fetches of "the same"
-- real workout aren't guaranteed to produce the same workout_at.
--
-- WorkoutSample.id is the field this codebase already treats as the real,
-- stable identity for a workout — see android's own getRecentWorkouts
-- comment ("needs to be stable across fetches on its own") and iOS's,
-- which uses HealthKit's own permanent w.uuid. That's what "the same real
-- workout" should actually mean here, not its timestamp.
--
-- Run this once, after 0053, in the SQL Editor.

alter table public.bingo_progress add column workout_key text;

drop index if exists public.bingo_progress_workout_once;

create unique index bingo_progress_workout_once
  on public.bingo_progress (challenge_id, user_id, workout_key)
  where workout_key is not null;

-- Existing rows (written before this column existed) have workout_key
-- null, which the partial index above never constrains — no backfill
-- possible from here (the original WorkoutSample.id was never stored),
-- so any bad double-link already in the database from before this fix
-- needs cleaning up by hand, not something this migration can undo.
