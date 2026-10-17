-- 0104: the hound's mood follows goal days and treats, a treat is once a
-- day, accessories are bought once and only owned ones go on, classic
-- care runs out of hearts and a meal fills one, and nobody can write
-- their own kennel.
select plan(15);

select tests.new_user('Ann') as ann \gset
select (now() at time zone 'utc')::date as today \gset
update public.profiles set bones_balance = 200 where id = :'ann';

select tests.sign_in(:'ann');
set local role authenticated;
select is((select mood from public.my_kennel(:'today')), 'sleepy', 'A new hound with no goal days is sleepy');
select is((select care_mode from public.my_kennel(:'today')), 'gentle', 'Gentle care by default');
reset role;

insert into public.activity_events (user_id, kind, score_points, xp_points, bones_points)
  select :'ann', 'goal_day', 0, 0, 0 from generate_series(1, 2);
-- The habit-XP trigger (0100) may have paid level-up Bones; start from here.
update public.profiles set bones_balance = 200 where id = :'ann';

select tests.sign_in(:'ann');
set local role authenticated;
select is((select mood from public.my_kennel(:'today')), 'okay', 'Two goal days this week: okay');
select public.give_treat(:'today');
select is((select mood from public.my_kennel(:'today')), 'happy', 'A treat cheers them up');
select throws_ok(format('select public.give_treat(%L)', :'today'), 'Already fed today. Back tomorrow.', 'One treat a day');

select public.set_kennel(:'today', '  Rex   the Hound ', null);
select is((select name from public.my_kennel(:'today')), 'Rex the Hound', 'Renamed, with spaces tidied');

select public.buy_kennel_item(:'today', 'hat_party');
select throws_ok(format('select public.buy_kennel_item(%L, ''hat_party'')', :'today'), 'You already have that.', 'Bought once');
select throws_ok(format('select public.equip_kennel_item(%L, ''head'', ''hat_crown'')', :'today'),
  'You don''t have that yet.', 'Only owned items go on');
select public.equip_kennel_item(:'today', 'head', 'hat_party');
select is((select head_id from public.my_kennel(:'today')), 'hat_party', 'An owned hat goes on');
select is((select bones_balance from public.my_kennel(:'today')), 90, 'The treat and the hat came off the balance');

select throws_ok('update public.kennels set hearts = 3', '42501', null, 'Nobody can write their own kennel');

select public.set_kennel(:'today', null, 'classic');
select is((select hearts from public.my_kennel(:'today')), 3, 'Classic care starts with full hearts');
reset role;

update public.kennels set hearts_on = :'today'::date - 3, treated_on = :'today'::date - 3 where user_id = :'ann';

select tests.sign_in(:'ann');
set local role authenticated;
select is((select mood from public.my_kennel(:'today')), 'hungry', 'Three days unfed: hungry');
select public.give_treat(:'today');
select is((select hearts from public.my_kennel(:'today')), 1, 'A meal fills a heart');
select public.set_kennel(:'today', null, 'gentle');
select is((select hearts from public.my_kennel(:'today')), null, 'Back to gentle: no hearts');
reset role;

select * from finish();
