-- Hound: Hoops and H-O-R-S-E — two new challenge kinds. See
-- 0195_hoops.sql and 0196_horse.sql for the games; this migration only
-- adds the enum values.
--
-- Postgres won't let a new enum value be used in the same transaction it
-- was added in, so this runs and commits on its own before 0195 — same
-- split as 0166/0167 (Baseball).
--
-- Run this once, after 0193, in the SQL Editor — as its own query, not
-- pasted together with 0195.

alter type public.challenge_kind add value if not exists 'hoops';
alter type public.challenge_kind add value if not exists 'horse';
