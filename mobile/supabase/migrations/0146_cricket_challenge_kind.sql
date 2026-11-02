-- Hound: Cricket — a new challenge kind. See 0147_cricket.sql for the
-- match itself; this migration only adds the enum value.
--
-- Postgres won't let a new enum value be used in the same transaction it
-- was added in, so this runs and commits on its own before 0147 — same
-- split as 0141/0142 (Soccer).
--
-- Run this once, after 0145, in the SQL Editor — as its own query, not
-- pasted together with 0147.

alter type public.challenge_kind add value if not exists 'cricket';
