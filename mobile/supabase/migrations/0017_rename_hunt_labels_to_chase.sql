-- Hound: the app's own default terminology for a hunt's two customizable
-- roles is changing to be more generic — "Hunter" becomes "Hound" and
-- "Hunted" becomes "Fox" (the challenge kind itself is now displayed as
-- "Chase" instead of "Hunter & Hunted", but that name isn't stored here —
-- see huntKindName in src/challenges/present.ts, which is now a fixed
-- word independent of this table). "Zombie" is unaffected.
--
-- This only updates the column defaults and the one existing singleton
-- row (see 0015_app_labels.sql) — and only where that row still holds the
-- old default wording, so a group that already customized its own labels
-- keeps what it chose rather than being overwritten.
--
-- Run this once, after 0001-0016, in the SQL Editor.

alter table public.app_labels
  alter column hunter_label set default 'Hound',
  alter column hunted_label set default 'Fox';

update public.app_labels set hunter_label = 'Hound' where hunter_label = 'Hunter';
update public.app_labels set hunted_label = 'Fox' where hunted_label = 'Hunted';
