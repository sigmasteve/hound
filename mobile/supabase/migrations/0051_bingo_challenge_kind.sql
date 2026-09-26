-- Hound: Variety Bingo — a new challenge kind. See
-- 0052_bingo_progress.sql for the actual game-state schema this
-- enables; this migration only adds the enum value itself.
--
-- Postgres won't let a new enum value be used by another statement in
-- the same transaction it was added in (ALTER TYPE ... ADD VALUE can't
-- be followed by a use of that value until it's committed) — so this is
-- its own migration, run and committed on its own before 0052 (which
-- does use 'bingo' as a literal), same as 0044/0045's split for Tag.
--
-- Run this once, after 0050, in the SQL Editor — as its own query, not
-- pasted together with 0052.

alter type public.challenge_kind add value if not exists 'bingo';
