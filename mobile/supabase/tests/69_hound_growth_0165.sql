-- 0165: fitness from active days, age stages, older hounds grown,
-- traits earned and kept, the birthday (and its once-a-month limit), the
-- party guest, a friend's view, and the admin overview.
select plan(15);

select tests.new_user('Ann', true) as ann \gset
select tests.new_user('Sis') as sis \gset
select tests.new_user('Stranger') as stranger \gset
select (now() at time zone 'utc')::date as today \gset
update public.profiles set last_active_at = now() where id in (:'ann', :'sis');
insert into public.kennels (user_id, name, grown_before) values (:'ann', 'Rex', true);
insert into public.friendships (requester_id, recipient_id, status) values (:'ann', :'sis', 'accepted');

select tests.sign_in(:'sis');
set local role authenticated;
select is(public.my_hound_profile(:'today') ->> 'stage', 'puppy', 'A new hound is a puppy');
select is((public.my_hound_profile(:'today') ->> 'fitness')::int, 1, 'and starts at fitness 1');
reset role;

-- Four active days, and a month of steps since it was born.
update public.kennels set born_on = :'today'::date - 30 where user_id = :'sis';
insert into public.daily_step_totals (user_id, day, steps)
  select :'sis', :'today'::date - g, case when g < 4 then 6000 else 3500 end from generate_series(0, 29) g;
select tests.sign_in(:'sis');
set local role authenticated;
select is((public.my_hound_profile(:'today') ->> 'fitness')::int, 2, '4 active days is fitness 2');
select is((public.my_hound_profile(:'today') ->> 'fitness_next')::int, 7, 'and 7 is next');
select is(public.my_hound_profile(:'today') ->> 'stage', 'young', '100,000 steps since it was born: young');
reset role;

-- Eight early walks this month: Early bird, kept even once they're gone.
insert into public.hound_walks (user_id, day, start_minute, started_at, ended_at, steps)
  select :'sis', :'today'::date - g, 420, now() - make_interval(days => g, mins => 60), now() - make_interval(days => g, mins => 30), 3000
  from generate_series(1, 8) g;
select tests.sign_in(:'sis');
set local role authenticated;
select ok(public.my_hound_profile(:'today') -> 'traits' @> '[{"id": "early_bird"}]', 'Early walks earn Early bird');
reset role;
delete from public.hound_walks where user_id = :'sis';
select tests.sign_in(:'sis');
set local role authenticated;
select ok(public.my_hound_profile(:'today') -> 'traits' @> '[{"id": "early_bird"}]', 'and a trait is kept for good');

-- The birthday: today, so the party's on, with a friend's hound.
select ok((public.set_hound_birthday(:'today', :'today'::date - 365) ->> 'is_birthday')::boolean, 'Set to today''s date: it''s the birthday');
select is(public.my_hound_profile(:'today') -> 'party_guest' ->> 'name', 'Rex', 'and a friend''s hound comes to the party');
select throws_ok(format('select public.set_hound_birthday(%L, %L)', :'today', :'today'), null, null, 'It changes once a month at most');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select is(public.my_hound_profile(:'today') ->> 'stage', 'grown', 'A hound from before this is grown');
select ok((public.friend_hound_profile(:'sis', :'today') ->> 'is_birthday')::boolean, 'A friend sees it''s the birthday');
select is((public.admin_growth_overview() ->> 'hounds')::int, 2, 'The admin sees both hounds');
reset role;

select tests.sign_in(:'stranger');
set local role authenticated;
select throws_ok(format('select public.friend_hound_profile(%L, %L)', :'sis', :'today'), 'Only friends can see each other''s hounds.', 'Not for strangers');
select throws_ok($$ select public.admin_growth_overview() $$, 'not authorized', 'Members can''t see the overview');
reset role;

select * from finish();
