-- Hound: manually linking a real device workout to a Variety Bingo
-- square — see 0052_bingo_progress.sql for the table this extends.
--
-- Motivating case: a future themed card (Strength: Arms/Legs/Chest/Back)
-- has categories HealthKit/Health Connect simply cannot tell apart —
-- there's no muscle-group signal on a workout, only an activity type
-- ("Functional Strength Training"). classifyWorkout's keyword auto-fill
-- (deviceSync.ts) can never fill a square like that; the person has to
-- say so themselves, by picking today's actual logged workout that box
-- means. This is generic to any bingo card, not just a future one — the
-- existing Variety card's own squares get the same "or link it yourself"
-- escape hatch, e.g. for a workout named too ambiguously for the
-- classifier to catch.
--
-- `source` distinguishes the two ways a square gets filled; `workout_name`/
-- `workout_at` are a snapshot of the WorkoutSample that filled it (both
-- for an auto-classified square too, not just a manual one — see
-- syncBingoProgressFromDevice's updated comment) so the UI can show
-- "Legs — linked to Leg day, 6:15pm" either way, not just for manual
-- links. Both null only for a row written before this migration.
alter table public.bingo_progress
  add column source text not null default 'auto' check (source in ('auto', 'manual')),
  add column workout_name text,
  add column workout_at timestamptz;

-- Stops the same real-world workout being linked (manually) to two
-- different squares — a session started at one exact instant is one
-- real thing that happened, not something that should be able to fill
-- both "Arms" and "Legs" from a single tap-twice mistake. A partial
-- index (not a plain table constraint) so it only ever applies to rows
-- that actually carry a workout_at — nothing to conflict with for a row
-- written before this migration, which has none.
create unique index bingo_progress_workout_once
  on public.bingo_progress (challenge_id, user_id, workout_at)
  where workout_at is not null;

-- A manual link can be re-picked (tap the square again, choose a
-- different workout from today) — that's an update to the existing row,
-- not a new one, since (challenge_id, user_id, category) is still the
-- primary key. auto-fill never needs this: syncBingoProgressFromDevice's
-- own upsert always ignores a conflict rather than overwriting (an
-- auto-classified re-sync should never clobber a person's own manual
-- correction), so only a manual re-link ever actually updates a row.
create policy "Users can update their own bingo progress"
  on public.bingo_progress for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
