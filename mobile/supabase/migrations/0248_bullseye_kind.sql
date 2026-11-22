-- Hound: Bullseye — a new challenge kind (archery). See 0249_bullseye.sql
-- for the game itself; this migration only adds the enum value.
--
-- Postgres won't let a new enum value be used in the same transaction it
-- was added in, so this runs and commits on its own before 0249, the
-- same split as 0246/0247 (Long Shot).
--
-- Run this once, after 0247, in the SQL Editor, as its own query, not
-- pasted together with 0249.

alter type public.challenge_kind add value if not exists 'bullseye';
