-- Hound: the Hound Shootout — a new challenge kind (global only). See
-- 0221_shootout.sql for the game; this migration only adds the enum value.
--
-- Postgres won't let a new enum value be used in the same transaction it
-- was added in, so this runs and commits on its own before 0221 — same
-- split as 0210/0211 (the Derby).
--
-- Run this once, after 0219, in the SQL Editor — as its own query, not
-- pasted together with 0221.

alter type public.challenge_kind add value if not exists 'shootout';
