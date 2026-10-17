-- 0098: Admin → Goals numbers, for platform admins only.
select plan(5);

select tests.new_user('Ann', true) as ann \gset
select tests.new_user('Bob') as bob \gset

update public.profiles set last_active_at = now() where id in (:'ann', :'bob');

-- Bob sets his goals, adds a run goal, picks Relentless, and walked
-- 12,000 steps yesterday against a 10,000 goal.
select tests.sign_in(:'bob');
set local role authenticated;
select public.ensure_starter_goals(10000, 3);
insert into public.goals (user_id, metric, period, target, activity) values (auth.uid(), 'workouts', 'week', 2, 'run');
insert into public.hound_settings (user_id, level, goals_set_at) values (auth.uid(), 'relentless', now());
select throws_ok('select public.admin_goals_overview()', 'not authorized', 'Only admins can see the goal numbers');
reset role;

insert into public.daily_step_totals (user_id, day, steps)
values (:'bob', (now() at time zone 'UTC')::date - 1, 12000);

select tests.sign_in(:'ann');
set local role authenticated;
select is((public.admin_goals_overview() ->> 'goals_set')::int, 1, 'Counts who set their own goals');
select is((public.admin_goals_overview() ->> 'custom_goals')::int, 1, 'Counts who added a goal of their own');
select is((public.admin_goals_overview() -> 'levels' ->> 'relentless')::int, 1, 'Counts hounding levels');
select is((public.admin_goals_overview() ->> 'steps_hit')::int, 1, 'Counts who hit their steps goal yesterday');
reset role;

select * from finish();
