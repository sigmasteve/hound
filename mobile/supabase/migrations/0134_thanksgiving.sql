-- Hound: Thanksgiving in the Kennel and the Locker. Limited-time items on
-- sale through November 30 (the app shows them from November 1); anyone
-- who buys one keeps it for good, the way Halloween's worked (0071,
-- 0112). Halloween's own items end on their dates and need nothing here.
--
-- Kennel (buy_kennel_item checks available_until against the member's
-- own date): a Pilgrim Hat, a Turkey Hat (a fan of tail feathers), a
-- Harvest Bandana and a Maple coat.
--
-- Locker (purchase_cosmetic checks available_until against now()): two
-- rings, two backgrounds and three icons.
--
-- Run this once, after 0001-0133, in the SQL Editor, before publishing
-- the app update that goes with it.

insert into public.kennel_items (id, slot, name, cost_bones, available_until) values
  ('hat_pilgrim', 'head', 'Pilgrim Hat', 100, '2026-11-30'),
  ('hat_turkey', 'head', 'Turkey Hat', 120, '2026-11-30'),
  ('bandana_harvest', 'neck', 'Harvest Bandana', 60, '2026-11-30'),
  ('coat_maple', 'coat', 'Maple', 120, '2026-11-30')
on conflict (id) do update set available_until = excluded.available_until;

insert into public.cosmetic_items (id, slot, name, cost_bones, available_until) values
  ('frame_maple', 'frame', 'Maple Ring', 300, '2026-12-01 08:00:00+00'),
  ('frame_harvest_gold', 'frame', 'Harvest Gold Ring', 450, '2026-12-01 08:00:00+00'),
  ('bg_harvest', 'background', 'Harvest', 350, '2026-12-01 08:00:00+00'),
  ('bg_pumpkin_pie', 'background', 'Pumpkin Pie', 600, '2026-12-01 08:00:00+00'),
  ('icon_acorn', 'icon', 'Acorn', 300, '2026-12-01 08:00:00+00'),
  ('icon_leaf', 'icon', 'Autumn Leaf', 400, '2026-12-01 08:00:00+00'),
  ('icon_turkey', 'icon', 'Turkey', 550, '2026-12-01 08:00:00+00')
on conflict (id) do update set available_until = excluded.available_until;

-- Undo, if needed (the items stay with anyone who bought them):
--   update public.kennel_items set available_until = '2000-01-01' where available_until = '2026-11-30';
--   update public.cosmetic_items set available_until = '2000-01-01' where available_until = '2026-12-01 08:00:00+00';
