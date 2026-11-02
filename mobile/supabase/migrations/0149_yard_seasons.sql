-- Hound: the Yard's limited-time items, the way the Kennel's work (0112,
-- 0134): on sale for a season, kept for good by anyone who buys one.
-- buy_kennel_item already refuses one after its available_until; the
-- app shows each from its first day (src/kennel/yardItems.ts).
--
--   Autumn, through November 30: a Pumpkin Patch for the ground.
--   Winter, December: a Gingerbread House, a Snowman for the ground and
--   a Holiday Garland for the fence.
--
-- The seasonal dressing itself (leaves, a jack-o'-lantern, snow) is
-- drawn by the app from the date and needs nothing here.
--
-- Run this once, after 0001-0148, in the SQL Editor, before publishing
-- the app update that goes with it.

insert into public.kennel_items (id, slot, name, cost_bones, available_until) values
  ('ground_pumpkins', 'ground', 'Pumpkin Patch', 80, '2026-11-30'),
  ('house_gingerbread', 'house', 'Gingerbread House', 200, '2026-12-31'),
  ('ground_snowman', 'ground', 'Snowman', 100, '2026-12-31'),
  ('fence_garland', 'fence', 'Holiday Garland', 60, '2026-12-31')
on conflict (id) do update set available_until = excluded.available_until;

-- Undo, if needed (the items stay with anyone who bought them):
--   update public.kennel_items set available_until = '2000-01-01'
--     where id in ('ground_pumpkins', 'house_gingerbread', 'ground_snowman', 'fence_garland');
