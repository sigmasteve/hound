-- Hound: Game of Tag — a new, deliberately non-competitive challenge kind.
-- See 0044_tag_game_state.sql for the actual game-state schema this
-- enables; this migration only adds the enum value itself.
--
-- Postgres won't let a new enum value be used by another statement in
-- the same transaction it was added in (ALTER TYPE ... ADD VALUE can't
-- be followed by a use of that value until it's committed) — so this is
-- its own migration, run and committed on its own before 0044 (which
-- does use 'tag' as a literal) rather than both in one script.
--
-- Run this once, after 0042, in the SQL Editor — as its own query, not
-- pasted together with 0044.

alter type public.challenge_kind add value if not exists 'tag';
