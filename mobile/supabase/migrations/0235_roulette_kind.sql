-- Hound: Hound Roulette — a new challenge kind. See 0236_roulette.sql for
-- the game itself; this migration only adds the enum value.
--
-- Postgres won't let a new enum value be used in the same transaction it
-- was added in, so this runs and commits on its own before 0236, the
-- same split as 0224/0225 (Hound Bout).
--
-- Run this once, after 0234, in the SQL Editor, as its own query, not
-- pasted together with 0236.

alter type public.challenge_kind add value if not exists 'roulette';
