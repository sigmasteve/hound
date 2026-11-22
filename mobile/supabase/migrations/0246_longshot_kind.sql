-- Hound: Long Shot — a new challenge kind. See 0247_longshot.sql for the
-- game itself; this migration only adds the enum value.
--
-- Postgres won't let a new enum value be used in the same transaction it
-- was added in, so this runs and commits on its own before 0247, the
-- same split as 0241/0242 (Paw Slots).
--
-- Run this once, after 0245, in the SQL Editor, as its own query, not
-- pasted together with 0247.

alter type public.challenge_kind add value if not exists 'longshot';
