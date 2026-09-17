-- Hound: wires up the "head start" slider on the Create screen, which
-- has been purely decorative since it was added — CreateScreen captured
-- a value but never sent it anywhere, and nothing ever read one back.
--
-- Same pattern as scoring_method (0004_hunt_scoring_and_roles.sql): a
-- nullable, hunt-only column on challenges, set once at creation and
-- never updated afterward, covered by 0001's existing insert/select
-- policies on challenges — no new RLS needed.
--
-- Run this once, after 0001-0010, in the SQL Editor.

alter table public.challenges add column head_start_days int;
