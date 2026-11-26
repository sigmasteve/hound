-- 0274: fasting and logging an activity from the watch; widget taps.
select plan(15);

select tests.new_user('Ann Lee') as ann \gset
select tests.new_user('Ada', true) as ada \gset
update public.profiles set created_at = now() - interval '60 days', time_zone = 'UTC' where id = :'ann';
update public.workout_log_config set enabled = true where id;

set local role anon;
select public.watch_pair_start('0123456789abcdef0123456789abcdef-secret') as pair \gset
reset role;
select tests.sign_in(:'ann');
set local role authenticated;
select public.link_watch(lower(:'pair'::jsonb->>'code')) as linked \gset
reset role;
select (:'pair'::jsonb->>'device_id') as dev \gset
select '0123456789abcdef0123456789abcdef-secret' as sec \gset
select (now() at time zone 'UTC')::date as today \gset

set local role anon;
select is((public.watch_today(:'dev', :'sec', :'today') -> 'fasting' ->> 'age'), null, 'Fasting not set up: no age answer yet');
select throws_ok(format('select public.watch_fasting_start(%L, %L, %L)', :'dev', :'sec', :'today'), 'Fasting is for people 16 and older.', 'So no fast from the watch');
reset role;

insert into public.fasting_profiles (user_id, age, plan_hours) values (:'ann', 'ok', 18);
set local role anon;
select is((public.watch_fasting_start(:'dev', :'sec', :'today') -> 'open' ->> 'goal_hours'), '18', 'Starts on her plan, 18 h');
select is((public.watch_today(:'dev', :'sec', :'today') -> 'fasting' -> 'open' ->> 'goal_hours'), '18', 'watch_today shows the fast');
select throws_ok(format('select public.watch_fasting_start(%L, %L, %L, 16)', :'dev', :'sec', :'today'), 'You''re already fasting.', 'Not two at once');
reset role;
update public.fasts set started_at = now() - interval '19 hours' where user_id = :'ann' and ended_at is null;
set local role anon;
select is((public.watch_fasting_end(:'dev', :'sec', :'today') ->> 'on_plan')::boolean, true, 'Ended after 19 h: on plan');
select is((public.watch_today(:'dev', :'sec', :'today') -> 'fasting' -> 'open'), 'null'::jsonb, 'No open fast now');
reset role;
select is((select count(*)::int from public.fasts where user_id = :'ann' and ended_at is not null), 1, 'The fast is Ann''s, ended');

set local role anon;
select public.watch_log_activity(:'dev', :'sec', :'today', 'yoga', 30) as act \gset
select is(:'act'::jsonb ->> 'minutes', '30', 'Yoga, 30 minutes, from the wrist');
reset role;
select is((select count(*)::int from public.workout_history where user_id = :'ann' and source = 'manual'), 1, 'It''s a logged workout, like the phone''s');
set local role anon;
select lives_ok(format('select public.watch_undo_activity(%L, %L, %L)', :'dev', :'sec', :'act'::jsonb ->> 'source_id'), 'Undo from the watch');
reset role;
select is((select count(*)::int from public.workout_history where user_id = :'ann' and source = 'manual'), 0, 'Undone');

-- Widget taps, and Admin.
select tests.sign_in(:'ann');
set local role authenticated;
do $$ begin
  perform public.note_widget_tap('fasting');
  perform public.note_widget_tap('activity');
  perform public.note_widget_tap('fasting');
  perform public.note_widget_tap('bogus');
end $$;
reset role;
select tests.sign_in(:'ada');
set local role authenticated;
select public.admin_watch_overview() as o \gset
reset role;
select is((:'o'::jsonb -> 'widget_taps_7d' ->> 'fasting')::int, 2, 'Two Fasting widget taps');
select is((:'o'::jsonb ->> 'fast_starts_7d')::int, 1, 'One fast started from a watch');
select is((:'o'::jsonb ->> 'activities_7d')::int, 1, 'One activity from a watch');

select * from finish();
