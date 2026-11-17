-- 0216: the Kennel's unlock ladder on the server, and Admin's numbers.
select plan(14);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bea') as bea \gset
select tests.new_user('Ada', true) as ada \gset
select (now() at time zone 'utc')::date as today \gset

-- Level 4 (240 XP) with plenty of Bones.
update public.profiles set xp_total = 240, bones_balance = 50000, last_active_at = now() where id = :'ann';
update public.profiles set xp_total = 0, bones_balance = 50000, last_active_at = now() where id = :'bea';

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok(format($q$select public.buy_kennel_item(%L::date, 'zone_porch')$q$, :'today'),
  'The Porch opens at Tracker (level 5).', 'No Porch at level 4');
select throws_ok(format($q$select public.buy_kennel_item(%L::date, (select id from public.kennel_items where slot = 'room' order by cost_bones limit 1))$q$, :'today'),
  'The Room opens at level 8.', 'No Room at level 4');
select throws_ok(format($q$select public.buy_kennel_item(%L::date, (select id from public.kennel_items where slot = 'house' and cost_bones > 0 order by cost_bones limit 1))$q$, :'today'),
  'Bougie houses open at level 7.', 'No bougie house at level 4');
select throws_ok(format($q$select public.buy_kennel_item(%L::date, (select id from public.kennel_items where slot = 'neck' order by cost_bones limit 1))$q$, :'today'),
  'The rest of the wardrobe opens at level 6.', 'No neckwear at level 4');
select lives_ok(format($q$select public.buy_kennel_item(%L::date, (select id from public.kennel_items where slot = 'trick' order by cost_bones limit 1))$q$, :'today'),
  'Tricks at level 4');
select lives_ok(format($q$select public.buy_kennel_item(%L::date, (select id from public.kennel_items where slot = 'head' and cost_bones > 0 order by cost_bones limit 1))$q$, :'today'),
  'Hats from day one');
reset role;

-- Level 5: the Porch.
update public.profiles set xp_total = 350 where id = :'ann';
select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok(format($q$select public.buy_kennel_item(%L::date, 'zone_porch')$q$, :'today'), 'The Porch at level 5');
reset role;

-- Level 0: no tricks yet; but a trick bought before the ladder keeps the door open.
select tests.sign_in(:'bea');
set local role authenticated;
select throws_ok(format($q$select public.buy_kennel_item(%L::date, (select id from public.kennel_items where slot = 'trick' order by cost_bones limit 1))$q$, :'today'),
  'Tricks open at level 2.', 'No tricks at level 0');
reset role;
insert into public.kennel_purchases (user_id, item_id, bones)
  select :'bea', id, 0 from public.kennel_items where slot = 'trick' order by cost_bones limit 1;
select tests.sign_in(:'bea');
set local role authenticated;
select lives_ok(format($q$select public.buy_kennel_item(%L::date, (select id from public.kennel_items where slot = 'trick' order by cost_bones desc limit 1))$q$, :'today'),
  'Someone who already has a trick keeps buying them');
reset role;

-- The guards on planting, baking and gifting.
select throws_ok(format($q$insert into public.garden_plantings (user_id, plot, seed_id, planted_on) values (%L, 0, 'sunflower', current_date)$q$, :'bea'),
  'The Garden opens at level 3.', 'No planting at level 0');
select throws_ok(format($q$insert into public.hound_treats (user_id, made_by, recipe_id, used, bones) values (%L, %L, 'pumpkin_biscuits', '{}', 0)$q$, :'bea', :'bea'),
  'The Kitchen opens at level 4.', 'No baking at level 0');
select throws_ok(format($q$insert into public.kennel_gifts (from_id, to_id, item_id, bones) values (%L, %L, 'house_classic', 0)$q$, :'ann', :'bea'),
  'Gifting opens at level 9.', 'No gifting at level 5');

-- Admin.
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($q$select public.admin_kennel_unlocks_overview()$q$, 'not authorized', 'Admins only');
reset role;
select tests.sign_in(:'ada');
set local role authenticated;
select is((select (x ->> 'using')::int from jsonb_array_elements(public.admin_kennel_unlocks_overview() -> 'unlocks') x where x ->> 'key' = 'porch') >= 1,
  true, 'Admin counts who opened the Porch');
reset role;

select * from finish();
