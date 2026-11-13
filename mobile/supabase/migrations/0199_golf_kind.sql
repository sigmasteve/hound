-- Hound: Golf — a new challenge kind. See 0200_golf.sql for the game and
-- 0201_golf_courses.sql for its courses; this migration only adds the
-- enum value.
--
-- Postgres won't let a new enum value be used in the same transaction it
-- was added in, so this runs and commits on its own before 0200 — same
-- split as 0194/0195 (Hoops).
--
-- Run this once, after 0197 (and 0198 if it's in), in the SQL Editor — as
-- its own query, not pasted together with 0200.

alter type public.challenge_kind add value if not exists 'golf';
