-- Hound: Hound Bout — a new challenge kind (1 on 1 boxing). See
-- 0225_bout.sql for the game; this migration only adds the enum value.
--
-- Postgres won't let a new enum value be used in the same transaction it
-- was added in, so this runs and commits on its own before 0225.
--
-- Run this once, after 0223, in the SQL Editor — as its own query, not
-- pasted together with 0225.

alter type public.challenge_kind add value if not exists 'bout';
