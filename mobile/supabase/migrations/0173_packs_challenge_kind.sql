-- Hound: Pack Wars — a new challenge kind. See 0174_pack_wars.sql for the
-- game itself; this migration only adds the enum value.
--
-- Postgres won't let a new enum value be used in the same transaction it
-- was added in, so this runs and commits on its own before 0174, the
-- same split as 0171/0172 (Daily Doors).
--
-- Run this once, after 0172, in the SQL Editor, as its own query, not
-- pasted together with 0174.

alter type public.challenge_kind add value if not exists 'packs';
