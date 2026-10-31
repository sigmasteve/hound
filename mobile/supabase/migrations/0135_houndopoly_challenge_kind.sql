-- Hound: Hound'opoly — a new challenge kind. See 0136_houndopoly.sql for
-- the board, players and nightly moves this enables; this migration only
-- adds the enum value itself.
--
-- Postgres won't let a new enum value be used in the same transaction it
-- was added in, so this runs and commits on its own before 0136 — same
-- split as 0125/0126 (Accountability).
--
-- Run this once, after 0134, in the SQL Editor — as its own query, not
-- pasted together with 0136.

alter type public.challenge_kind add value if not exists 'houndopoly';
