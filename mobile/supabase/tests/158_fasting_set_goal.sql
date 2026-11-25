-- 0273: change the goal of the fast you're on.
select plan(8);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Kid') as kid \gset
insert into public.fasting_profiles (user_id, age, plan_hours) values (:'ann', 'ok', 23), (:'kid', 'under', 16);

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.fasting_set_goal(20)$$, 'You''re not fasting.', 'Needs a fast going');
do $$ begin perform public.fasting_start(23, now() - interval '2 hours'); end $$;
select is((public.fasting_set_goal(20)) ->> 'goal_hours', '20', 'Changed to 20 h');
reset role;
select is((select goal_hours from public.fasts where user_id = :'ann' and ended_at is null), 20, 'The fast has the new goal');
select is((select plan_hours from public.fasting_profiles where user_id = :'ann'), 20, 'And it''s the plan next time');
set local role authenticated;
select throws_ok($$select public.fasting_set_goal(30)$$, 'A plan is 12 to 24 hours.', 'Not past 24 h');
reset role;
update public.fasts set started_at = now() - interval '13 hours' where user_id = :'ann' and ended_at is null;
set local role authenticated;
select throws_ok($$select public.fasting_set_goal(12)$$, 'You''ve already fasted 13 h. Pick a longer goal, or end your fast.', 'Not below what''s been fasted');
select is((public.fasting_set_goal(16)) ->> 'goal_hours', '16', 'Longer than what''s fasted is fine');
reset role;

select tests.sign_in(:'kid');
set local role authenticated;
select throws_ok($$select public.fasting_set_goal(16)$$, 'Fasting is for people 16 and older.', 'Under 16: no');
reset role;

select * from finish();
