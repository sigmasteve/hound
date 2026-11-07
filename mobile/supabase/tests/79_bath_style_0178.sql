-- 0178: a 'do after the bath. Kept until the next long walk, seen by
-- friends, counted for Admin; the 0177 app's call still works.
select plan(11);

select tests.new_user('Ann', true) as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select current_date as today \gset
insert into public.daily_step_totals (user_id, day, steps) values (:'ann', :'today', 7000), (:'cat', :'today', 7000);
insert into public.friendships (requester_id, recipient_id, status) values (:'ann', :'bob', 'accepted');

create function pg_temp.walk(u uuid, m1 int, m2 int, steps int) returns void language sql as $$
  insert into public.hound_walks (user_id, day, start_minute, started_at, ended_at, steps)
  values (u, current_date, 600, now() - make_interval(mins => m1), now() - make_interval(mins => m2), steps);
$$;

select tests.sign_in(:'ann');
set local role authenticated;
select is(public.finish_bath(:'today', 4, false, 'bow') -> 'bath' ->> 'hairdo', 'bow', 'A bow after the bath');
select is((public.my_care(:'today') -> 'bath' ->> 'bath_bones')::int, 4, 'and the bubbles still pay');
reset role;

select tests.sign_in(:'bob');
set local role authenticated;
select is((select hairdo from public.friend_kennel(:'ann', :'today')), 'bow', 'Friends see the bow');
reset role;

-- A short walk keeps it; a long one brings the hound home messy.
update public.hound_baths set created_at = now() - interval '3 hours' where user_id = :'ann';
select pg_temp.walk(:'ann', 150, 140, 800);
select is(public.hound_hairdo(:'ann'), 'bow', 'A short walk keeps the ''do');
select pg_temp.walk(:'ann', 120, 60, 3500);
select is(public.hound_hairdo(:'ann'), null, 'A long walk ends it');
select tests.sign_in(:'bob');
set local role authenticated;
select is((select hairdo from public.friend_kennel(:'ann', :'today')), null, 'for friends too');
reset role;

-- The 0177 app's call (no 'do), and a 'do that isn't one.
select tests.sign_in(:'cat');
set local role authenticated;
select is((select public.finish_bath(p_day => :'today', p_bubbles => 2, p_golden => false)) -> 'bath' ->> 'bath_bones', '2',
  'The old call still finishes a bath');
reset role;
select is((select hairdo from public.hound_baths where user_id = :'cat'), null, 'with no ''do');
select throws_ok($$ insert into public.hound_baths (user_id, day, hairdo) values ('$$ || :'bob' || $$', current_date, 'mullet') $$,
  '23514', null, 'Only the four ''dos');

select tests.sign_in(:'ann');
set local role authenticated;
select is((public.admin_bath_overview() ->> 'styled_7d')::int, 1, 'One bath styled this week');
select is(public.admin_bath_overview() -> 'hairdos_7d' ->> 'bow', '1', 'with a bow');
reset role;

select * from finish();
