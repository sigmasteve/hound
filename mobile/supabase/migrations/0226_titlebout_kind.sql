-- Hound: Title Bout — a Global Hound Bout for the belt (new challenge kind).
-- See 0227_titlebout.sql for the game; this migration only adds the enum
-- value, committed on its own before 0227 (as 0224/0225).
--
-- Run this once, after 0225, in the SQL Editor — as its own query, not
-- pasted together with 0227.

alter type public.challenge_kind add value if not exists 'titlebout';
