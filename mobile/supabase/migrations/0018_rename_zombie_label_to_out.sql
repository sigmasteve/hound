-- Hound: continues 0017's terminology rename — "Zombie" (the role a
-- caught Hunted/Fox flips to, see HuntRole in src/challenges/types.ts)
-- becomes "Out" by default. Same "only touch it if it's still the old
-- default" rule as 0017, so a group that already customized this label
-- keeps what it chose.
--
-- Run this once, after 0001-0017, in the SQL Editor.

alter table public.app_labels
  alter column zombie_label set default 'Out';

update public.app_labels set zombie_label = 'Out' where zombie_label = 'Zombie';
