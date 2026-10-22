-- 0123: a Journey counts from the moment it starts. The day's miles so
-- far come off its first day, and only its first day.
select plan(7);

select tests.new_user('Ann') as ann \gset

\set TODAY '(now() at time zone ''utc'')::date'

select tests.sign_in(:'ann');
set local role authenticated;
insert into public.daily_miles (user_id, day, workout_mi, all_mi) values (auth.uid(), :TODAY, 3, 4.5);

-- Switching with 2 workout miles (3 all told) already walked today.
select ok(public.start_journey('golden-gate', 'Golden Gate Bridge', 1.7, :TODAY, 2, 3) is not null, 'Ann starts a journey part way through the day');
select is((select miles from public.my_journey()), 1.00, 'Only the workout miles since then count');
select public.set_journey_count_all(true);
select is((select miles from public.my_journey()), 1.50, 'Or every mile since then');

-- Later days count whole.
insert into public.daily_miles (user_id, day, workout_mi, all_mi) values (auth.uid(), :TODAY + 1, 2, 2);
select is((select miles from public.my_journey()), 3.50, 'The next day counts whole');

-- A phone that measured more than the day has synced can't take the
-- first day below zero, nor touch the days after it.
select public.start_journey('windy-city', 'Windy City 26.2', 26.2, :TODAY, 10, 10);
select is((select miles from public.my_journey()), 2.00, 'An oversized start empties the first day and leaves the next alone');
select public.set_journey_count_all(true);
select is((select miles from public.my_journey()), 2.00, 'Counting every mile too');

-- An older app, with no measurement: the day as last synced is the start.
select public.start_journey('thames', 'Thames 26.2', 26.2, :TODAY);
select is((select miles from public.my_journey()), 2.00, 'Without the phone''s number, the synced day is taken off');
reset role;

select * from finish();
