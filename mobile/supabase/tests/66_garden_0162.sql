-- 0162: the garden. A free seed a week, seed packs for Bones (in season),
-- planting, growth from steps after planting, picking once bloomed,
-- digging up, and the admin overview.
select plan(16);

select tests.new_user('Ann', true) as ann \gset
select tests.new_user('Sis') as sis \gset
select (now() at time zone 'utc')::date as today \gset
select k.id as off_season from public.garden_seed_kinds k
  where k.season is not null and k.season <> public.walk_season((now() at time zone 'utc')::date) limit 1 \gset
update public.profiles set bones_balance = 100 where id = :'sis';
insert into public.daily_step_totals (user_id, day, steps) values (:'sis', :'today', 3000);

select tests.sign_in(:'sis');
set local role authenticated;
select throws_ok(format('select public.claim_free_seed(%L, ''rose'')', :'today'), 'That one isn''t a free seed.',
  'Only some seeds are free');
select is((select (s ->> 'count')::int from jsonb_array_elements(public.claim_free_seed(:'today', 'sunflower') -> 'seeds') s where s ->> 'id' = 'sunflower'), 1,
  'The week''s free seed');
select throws_ok(format('select public.claim_free_seed(%L, ''daisy'')', :'today'), 'You''ve had this week''s free seed. Another comes on Monday.',
  'One a week');
select is((public.buy_seed_pack(:'today', 'daisy') ->> 'balance')::int, 70, 'A pack of daisies for 30 Bones');
select throws_ok(format('select public.buy_seed_pack(%L, %L)', :'today', :'off_season'), null, null, 'Seasonal seeds only in season');
select throws_ok(format('select public.buy_seed_pack(%L, ''giant_sunflower'')', :'today'), 'Not enough Bones.', 'Bones are checked');

select is((public.plant_seed(:'today', 0, 'sunflower') -> 'plots' -> 0 ->> 'steps')::int, 0,
  'Planted: today''s steps before planting don''t count');
select throws_ok(format('select public.plant_seed(%L, 0, ''daisy'')', :'today'), 'Something''s already growing there.', 'One per plot');
select throws_ok(format('select public.plant_seed(%L, 1, ''sunflower'')', :'today'), 'You don''t have that seed.', 'Planting uses up the seed');
reset role;

update public.daily_step_totals set steps = 13000 where user_id = :'sis' and day = :'today';
select tests.sign_in(:'sis');
set local role authenticated;
select is((public.my_garden(:'today') -> 'plots' -> 0 ->> 'steps')::int, 10000, 'Steps after planting make it grow');
select throws_ok(format('select public.pick_plant(%L, 0)', :'today'), 'It hasn''t bloomed yet.', 'Not picked before it blooms');
reset role;

update public.daily_step_totals set steps = 40000 where user_id = :'sis' and day = :'today';
select tests.sign_in(:'sis');
set local role authenticated;
select ok((public.my_garden(:'today') -> 'plots' -> 0 ->> 'bloomed_at') is not null, 'It blooms at 25,000 steps');
select is(jsonb_array_length(public.pick_plant(:'today', 0) -> 'plots'), 0, 'Picking frees the plot');
select is((select (x ->> 'count')::int from jsonb_array_elements(public.my_garden(:'today') -> 'picked') x where x ->> 'id' = 'sunflower'), 1,
  'and it''s in the garden log');
select public.plant_seed(:'today', 1, 'daisy') is not null as planted \gset
select is(jsonb_array_length(public.dig_up_plant(:'today', 1) -> 'plots'), 0, 'Digging up clears a plot');
select throws_ok($$ select public.admin_garden_overview() $$, 'not authorized', 'Members can''t see the overview');
reset role;

select * from finish();
