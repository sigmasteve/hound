-- Hound: Tic-Tac-Go — a new challenge kind. See 0057_tictacgo_game.sql
-- for the game-state schema this enables; this migration only adds the
-- enum value itself.
--
-- Postgres won't let a new enum value be used in the same transaction it
-- was added in, so this runs and commits on its own before 0057 — same
-- split as 0051/0052 (Bingo) and 0044/0045 (Tag).
--
-- Run this once, after 0055, in the SQL Editor — as its own query, not
-- pasted together with 0057.

alter type public.challenge_kind add value if not exists 'tictacgo';
