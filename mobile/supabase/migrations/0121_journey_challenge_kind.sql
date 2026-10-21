-- Hound: Journey — a new challenge kind. See 0122_journey_challenges.sql
-- for what it does; this migration only adds the enum value itself.
--
-- Postgres won't let a new enum value be used in the same transaction it
-- was added in, so this runs and commits on its own before 0122 — same
-- split as 0061/0062 (75 Day), 0056/0057 (Tic-Tac-Go), 0051/0052 (Bingo)
-- and 0044/0045 (Tag).
--
-- Run this once, after 0120, in the SQL Editor — as its own query, not
-- pasted together with 0122.

alter type public.challenge_kind add value if not exists 'journey';
