-- Hound: Paw Slots — a new challenge kind. See 0242_slots.sql for the
-- game itself; this migration only adds the enum value.
--
-- Postgres won't let a new enum value be used in the same transaction it
-- was added in, so this runs and commits on its own before 0242, the
-- same split as 0237/0238 (Hound Chess).
--
-- Run this once, after 0240, in the SQL Editor, as its own query, not
-- pasted together with 0242.

alter type public.challenge_kind add value if not exists 'slots';
