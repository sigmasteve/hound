-- 0183: a finished Journey can be taken off Today; its finish counts on.
select plan(4);

select tests.new_user('Ann') as ann \gset
\set TODAY '(now() at time zone ''utc'')::date'

select tests.sign_in(:'ann');
set local role authenticated;
select public.start_journey('golden-gate', 'Golden Gate Bridge', 1.7, :TODAY - 1);
insert into public.daily_miles (user_id, day, workout_mi, all_mi) values (auth.uid(), :TODAY, 3, 3);
select is(public.check_journey_finish(), true, 'Ann finishes the course');
select is((select count(*)::int from public.my_journey()), 1, 'and it shows as her Journey');
select public.end_journey();
select is((select count(*)::int from public.my_journey()), 0, 'Done: no Journey on Today');
reset role;
select is((select count(*)::int from public.journeys where user_id = :'ann' and finished_at is not null), 1, 'The finish still counts');

select * from finish();
