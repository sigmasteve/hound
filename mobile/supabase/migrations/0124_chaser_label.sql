-- Hound: a chase's hunter is a "Chaser", not a "Hound".
--
-- Since 0017 the hunter's default label was "Hound", which now collides
-- with your hound, the pet in the Kennel (0104): Create's step 3 asked
-- "Who's the Hound?" under a Today tile for your hound. The default
-- becomes "Chaser" for the shared row and for organizations, and any row
-- still on the old default follows; a label someone changed is kept.
--
-- Run this once, after 0123, in the SQL Editor. The app's own default
-- (src/labels/types.ts) changes with it.

alter table public.app_labels alter column hunter_label set default 'Chaser';
update public.app_labels set hunter_label = 'Chaser' where hunter_label = 'Hound';

alter table public.organization_labels alter column hunter_label set default 'Chaser';
update public.organization_labels set hunter_label = 'Chaser' where hunter_label = 'Hound';

-- Undo, if needed:
--   alter table public.app_labels alter column hunter_label set default 'Hound';
--   update public.app_labels set hunter_label = 'Hound' where hunter_label = 'Chaser';
--   alter table public.organization_labels alter column hunter_label set default 'Hound';
--   update public.organization_labels set hunter_label = 'Hound' where hunter_label = 'Chaser';
