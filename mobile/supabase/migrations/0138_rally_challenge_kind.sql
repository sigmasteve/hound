-- Hound: Rally — a new challenge kind. See 0139_rally.sql for the game
-- itself; this migration only adds the enum value.
--
-- Postgres won't let a new enum value be used in the same transaction it
-- was added in, so this runs and commits on its own before 0139 — same
-- split as 0135/0136 (Hound'opoly).
--
-- Run this once, after 0137, in the SQL Editor — as its own query, not
-- pasted together with 0139.

alter type public.challenge_kind add value if not exists 'rally';
