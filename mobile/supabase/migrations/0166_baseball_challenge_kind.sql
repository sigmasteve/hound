-- Hound: Baseball — a new challenge kind. See 0167_baseball.sql for the
-- game itself; this migration only adds the enum value.
--
-- Postgres won't let a new enum value be used in the same transaction it
-- was added in, so this runs and commits on its own before 0167 — same
-- split as 0141/0142 (Soccer) and 0146/0147 (Cricket).
--
-- Run this once, after 0165, in the SQL Editor — as its own query, not
-- pasted together with 0167.

alter type public.challenge_kind add value if not exists 'baseball';
