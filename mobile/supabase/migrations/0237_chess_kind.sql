-- Hound: Hound Chess — a new challenge kind. See 0238_chess.sql for the
-- game itself; this migration only adds the enum value.
--
-- Postgres won't let a new enum value be used in the same transaction it
-- was added in, so this runs and commits on its own before 0238, the
-- same split as 0235/0236 (Hound Roulette).
--
-- Run this once, after 0236, in the SQL Editor, as its own query, not
-- pasted together with 0238.

alter type public.challenge_kind add value if not exists 'chess';
