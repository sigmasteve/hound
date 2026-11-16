-- Hound: a bigger cup for full shots, so a well-struck par 3 can go in
-- (Steve, 16 Nov 2026: "raise the cup to 1.0 yards").
--
-- golf_config.cup is how close a shot that isn't a putt has to stop to the
-- pin to drop (0200): 0.6 yd until now, which made a hole-in-one take the
-- exact yardage and timing within a hair. Now 1.0 yd. Putts are unchanged
-- (putt_cup, 0.6 yd, the ring the app draws on the green).
--
-- Only the row still at the old default changes, in case it was set by hand.
--
-- Run this once, after 0001-0214, in the SQL Editor.

alter table public.golf_config alter column cup set default 1.0;
update public.golf_config set cup = 1.0, updated_at = now() where id and cup = 0.6;
