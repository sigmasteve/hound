-- Hound: the "Distance Pool" challenge kind is described (CHALLENGE_TYPES
-- in sampleData.ts) as "Add every mile the group covers toward one shared
-- target" — but there was never anywhere to set that target. The Create
-- screen's "Set the rules" step had no field for it at all.
--
-- Same pattern as head_start_days (0011_hunt_head_start.sql) and
-- scoring_method (0004_hunt_scoring_and_roles.sql): a nullable,
-- kind-specific column on challenges, set once at creation and never
-- updated afterward, covered by 0001's existing insert/select policies
-- on challenges — no new RLS needed.
--
-- Run this once, after 0001-0011, in the SQL Editor.

alter table public.challenges add column distance_goal_mi numeric;
