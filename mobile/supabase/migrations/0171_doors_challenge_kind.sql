-- Hound: Daily Doors ("Knock Knock, Hound") — a new challenge kind. See
-- 0172_doors.sql for the game itself; this migration only adds the enum
-- value.
--
-- Postgres won't let a new enum value be used in the same transaction it
-- was added in, so this runs and commits on its own before 0172, the
-- same split as 0166/0167 (Baseball).
--
-- Run this once, after 0170, in the SQL Editor, as its own query, not
-- pasted together with 0172.

alter type public.challenge_kind add value if not exists 'doors';
