-- 0184: holiday themes, scheduled in runs; the latest-starting run shows.
select plan(16);

select tests.new_user('Ann', true) as ann \gset
select tests.new_user('Bob') as bob \gset

-- Bob isn't an admin.
select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok($$select public.admin_save_holiday_run(null, 'christmas', '2026-12-01', '2026-12-26')$$, 'not authorized', 'Only admins schedule a theme');
select throws_ok($$select public.admin_holiday_overview('2026-11-09')$$, 'not authorized', 'Only admins see the numbers');
select is(public.get_holiday_theme('2026-11-09'), null, 'Nothing shows before anything is scheduled');
reset role;

-- Ann schedules Diwali for three days, then Christmas, and Thanksgiving
-- week inside it.
select tests.sign_in(:'ann');
set local role authenticated;
select public.admin_save_holiday_run(null, 'diwali', '2026-11-09', '2026-11-11') as diwali \gset
select public.admin_save_holiday_run(null, 'christmas', '2026-11-12', '2026-12-26', true) as xmas \gset
select public.admin_save_holiday_run(null, 'thanksgiving', '2026-11-23', '2026-11-27', false) as tg \gset
select throws_ok($$select public.admin_save_holiday_run(null, 'christmas', '2026-12-26', '2026-12-01')$$, 'It ends before it starts.', 'A run must end after it starts');
select throws_ok($$select public.admin_save_holiday_run(null, 'easter', '2027-03-01', '2027-03-02')$$, 'unknown theme', 'Only known themes');
reset role;

select tests.sign_in(:'bob');
set local role authenticated;
select is(public.get_holiday_theme('2026-11-10')->>'theme', 'diwali', 'Diwali shows for its days');
select is(public.get_holiday_theme('2026-11-12')->>'theme', 'christmas', 'Then Christmas, by itself');
select is(public.get_holiday_theme('2026-11-25')->>'theme', 'thanksgiving', 'Thanksgiving week shows inside the Christmas run');
select is((public.get_holiday_theme('2026-11-25')->>'effects')::boolean, false, 'with its own effects setting');
select is(public.get_holiday_theme('2026-11-28')->>'theme', 'christmas', 'And Christmas comes back after');
select is(public.get_holiday_theme('2026-12-27'), null, 'Nothing after the last run ends');

-- Bob sees Diwali twice, the second time with the sparkles off, and
-- taps the countdown.
select public.holiday_theme_seen('diwali', '2026-11-09', false);
select public.holiday_theme_seen('diwali', '2026-11-10', true);
select public.holiday_countdown_tap('diwali', '2026-11-10');
select public.holiday_countdown_tap('diwali', '2026-11-10');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select public.holiday_theme_seen('diwali', '2026-11-10', false);
select is(
  (select r from jsonb_array_elements(public.admin_holiday_overview('2026-11-10')->'runs') r where (r->>'id')::bigint = :diwali),
  jsonb_build_object('id', :diwali, 'theme', 'diwali', 'starts_on', '2026-11-09', 'ends_on', '2026-11-11', 'effects', true,
    'seen', 2, 'seen_today', 2, 'effects_off', 1, 'tappers', 1, 'taps', 2),
  'The Diwali run counts who saw it, today, the effects turned off and the taps'
);
select is(public.admin_holiday_overview('2026-11-10')->'showing'->>'theme', 'diwali', 'Admin sees what''s showing');

-- Stopping: a run that's begun ends yesterday; one to come is removed.
select public.admin_stop_holiday_run(:diwali, '2026-11-10');
select public.admin_stop_holiday_run(:tg, '2026-11-10');
reset role;
select is((select ends_on from public.holiday_theme_runs where id = :diwali), '2026-11-09'::date, 'Stopping Diwali ends it yesterday');
select is((select count(*)::int from public.holiday_theme_runs where id = :tg), 0, 'Stopping a run to come removes it');

select tests.sign_in(:'bob');
set local role authenticated;
select is(public.get_holiday_theme('2026-11-10'), null, 'Once stopped, it''s off today');
reset role;

select * from finish();
