-- Hound: Soccer — a new challenge kind. See 0142_soccer.sql for the
-- match itself; this migration only adds the enum value.
--
-- Postgres won't let a new enum value be used in the same transaction it
-- was added in, so this runs and commits on its own before 0142 — same
-- split as 0138/0139 (Rally).
--
-- Run this once, after 0140, in the SQL Editor — as its own query, not
-- pasted together with 0142.

alter type public.challenge_kind add value if not exists 'soccer';
