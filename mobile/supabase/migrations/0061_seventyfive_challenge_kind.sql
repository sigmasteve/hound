-- Hound: 75 Day Challenge — a new challenge kind. See
-- 0062_seventyfive.sql for the checklist schema this enables; this
-- migration only adds the enum value itself.
--
-- Postgres won't let a new enum value be used in the same transaction it
-- was added in, so this runs and commits on its own before 0062 — same
-- split as 0056/0057 (Tic-Tac-Go), 0051/0052 (Bingo), and 0044/0045 (Tag).
--
-- Run this once, after 0060, in the SQL Editor — as its own query, not
-- pasted together with 0062.

alter type public.challenge_kind add value if not exists 'seventyfive';
