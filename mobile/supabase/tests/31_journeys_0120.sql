-- 0120: journeys count miles from their start, finish once, end when
-- another starts, and friends (only friends) see each other on a course.
select plan(14);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
insert into public.friendships (requester_id, recipient_id, status) values (:'ann', :'bob', 'accepted');

\set TODAY '(now() at time zone ''utc'')::date'

select tests.sign_in(:'ann');
set local role authenticated;
-- Miles from before the journey started don't count.
insert into public.daily_miles (user_id, day, workout_mi, all_mi) values
  (auth.uid(), :TODAY - 2, 5, 6), (auth.uid(), :TODAY, 3, 4.5);
select ok(public.start_journey('golden-gate', 'Golden Gate Bridge', 1.7, :TODAY) is not null, 'Ann starts a journey');
select is((select miles from public.my_journey()), 3.00, 'Only workout miles from its first day count');
select public.set_journey_count_all(true);
select is((select miles from public.my_journey()), 4.50, 'Or every walking and running mile');
select is(public.check_journey_finish(), true, 'Reaching the course length finishes it');
select is(public.check_journey_finish(), false, 'and only once');
select is((select finished_count from public.my_journey()), 1, 'One course finished');

-- A phone that couldn't read its data sends 0; the miles stay.
update public.daily_miles set workout_mi = 0, all_mi = 0 where user_id = auth.uid() and day = :TODAY;
select is((select workout_mi from public.daily_miles where user_id = auth.uid() and day = :TODAY), 3.00, 'A 0 doesn''t wipe synced miles');

select public.start_journey('windy-city', 'Windy City 26.2', 26.2, :TODAY);
select is((select course_id from public.my_journey()), 'windy-city', 'A new journey is the current one');
select is((select count(*)::int from public.journeys where finished_at is null and ended_at is null), 1, 'Only one runs at a time');
reset role;

select tests.sign_in(:'bob');
set local role authenticated;
select is((select name from public.friends_on_course('windy-city')), 'Ann', 'A friend sees Ann on the course');
select is((select friends from public.friends_course_counts() where course_id = 'windy-city'), 1, 'and counts her in the picker');
reset role;

select tests.sign_in(:'cat');
set local role authenticated;
select is((select count(*)::int from public.friends_on_course('windy-city')), 0, 'Someone who isn''t her friend doesn''t');
select is((select count(*)::int from public.friends_course_counts()), 0, 'nor counts her');
select is((select count(*)::int from public.journeys), 0, 'Nobody else''s journeys are readable');
reset role;

select * from finish();
