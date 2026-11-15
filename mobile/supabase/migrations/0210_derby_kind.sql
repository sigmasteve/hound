-- Hound: the Home Run Derby — a new challenge kind (global only). See
-- 0211_derby.sql for the game; this migration only adds the enum value.
--
-- Postgres won't let a new enum value be used in the same transaction it
-- was added in, so this runs and commits on its own before 0211 — same
-- split as 0199/0200 (Golf).
--
-- Run this once, after 0209, in the SQL Editor — as its own query, not
-- pasted together with 0211.

alter type public.challenge_kind add value if not exists 'derby';
