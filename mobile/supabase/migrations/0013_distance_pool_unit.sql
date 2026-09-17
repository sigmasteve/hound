-- Hound: the Distance Pool group target added in 0012 only ever
-- supported miles. This adds a unit picker on the Create screen —
-- "Miles" (the existing distance_goal_mi) or "Steps" (this migration's
-- new distance_goal_steps), since most people know their daily step
-- count better than their mileage.
--
-- Purely additive, no backfill needed: distance_goal_unit null on an
-- existing row (every pool created before this migration) is read as
-- "miles" in code (see rowToChallenge) — exactly what distance_goal_mi
-- already meant on its own. Same nullable, kind-specific column
-- pattern as distance_goal_mi (0012) and head_start_days (0011),
-- covered by 0001's existing insert/select policies — no new RLS
-- needed.
--
-- Run this once, after 0001-0012, in the SQL Editor.

alter table public.challenges add column distance_goal_unit text check (distance_goal_unit in ('miles', 'steps'));
alter table public.challenges add column distance_goal_steps int;
