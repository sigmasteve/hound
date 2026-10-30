-- 0133: Admin → Engagement counts the breeds people's hounds wear and
-- have bought. Checked as differences, so other rows don't matter.
select plan(5);

select tests.new_user('Ada', true) as ada \gset
select tests.new_user('Bob') as bob \gset
select (now() at time zone 'utc')::date as today \gset
update public.profiles set bones_balance = 1300 where id = :'bob';

select tests.sign_in(:'ada');
set local role authenticated;
select public.admin_engagement() as before \gset
reset role;

-- Bob opens the Kennel, buys two breeds and wears one.
select tests.sign_in(:'bob');
set local role authenticated;
select public.buy_kennel_item(:'today', 'breed_corgi');
select public.buy_kennel_item(:'today', 'breed_poodle');
select public.equip_kennel_item(:'today', 'breed', 'breed_poodle');
reset role;

select tests.sign_in(:'ada');
set local role authenticated;
select public.admin_engagement() as after \gset
select is(jsonb_array_length(:'after'::jsonb #> '{kennel,breeds}'), 3, 'One entry per breed');
select is((:'after'::jsonb #>> '{kennel,kennels}')::int - (:'before'::jsonb #>> '{kennel,kennels}')::int, 1,
  'A new kennel counts');
select is(
  (select (b ->> 'wearing')::int from jsonb_array_elements(:'after'::jsonb #> '{kennel,breeds}') b where b ->> 'id' = 'breed_poodle')
  - (select (b ->> 'wearing')::int from jsonb_array_elements(:'before'::jsonb #> '{kennel,breeds}') b where b ->> 'id' = 'breed_poodle'),
  1, 'The breed worn counts as wearing');
select is(
  (select (b ->> 'bought')::int from jsonb_array_elements(:'after'::jsonb #> '{kennel,breeds}') b where b ->> 'id' = 'breed_corgi')
  - (select (b ->> 'bought')::int from jsonb_array_elements(:'before'::jsonb #> '{kennel,breeds}') b where b ->> 'id' = 'breed_corgi'),
  1, 'A breed bought but not worn counts as bought');
select is((:'after'::jsonb #>> '{kennel,hound}')::int - (:'before'::jsonb #>> '{kennel,hound}')::int, 0,
  'and not as a plain hound');
reset role;

select * from finish();
