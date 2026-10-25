-- Hound: Accountability challenge — a new challenge kind. See
-- 0126_checklist.sql for the checklist schema this enables; this
-- migration only adds the enum value itself.
--
-- Postgres won't let a new enum value be used in the same transaction it
-- was added in, so this runs and commits on its own before 0126 — same
-- split as 0121/0122 (Journey) and 0061/0062 (75 Day).
--
-- Run this once, after 0124, in the SQL Editor — as its own query, not
-- pasted together with 0126.

alter type public.challenge_kind add value if not exists 'checklist';
