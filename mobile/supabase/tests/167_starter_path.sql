-- 0282: the starter path ("Your first week").
select plan(16);

-- Accounts made before the path started keep Finish setting up.
select tests.new_user('Old') as old \gset
update public.profiles set created_at = now() - interval '30 days' where id = :'old';
update public.starter_config set start_after = now() - interval '1 day' where id;

select tests.new_user('Ann') as ann \gset
select tests.new_user('Boss', true) as boss \gset
update public.profiles set hound_uses = array['steps', 'fasting', 'activities'] where id = :'ann';
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, is_global) values
  ('00000000-0000-0000-0000-0000000000c1', 'Auto race', 'steps', :'boss', 7, now() - interval '1 day', now() + interval '6 days', true),
  ('00000000-0000-0000-0000-0000000000c2', 'Holiday race', 'steps', :'boss', 7, now() - interval '1 day', now() + interval '6 days', true);

select tests.sign_in(:'old');
set local role authenticated;
select is(public.my_starter_path() ->> 'show', 'false', 'An older account doesn''t get it');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select public.my_starter_path() as p \gset
select is(:'p'::jsonb ->> 'show', 'true', 'A new account gets it');
select is((select jsonb_agg(s ->> 'id') from jsonb_array_elements(:'p'::jsonb -> 'steps') s), '["goal", "fast", "move", "global"]'::jsonb,
  'Steps from what was ticked, then a Global');
select is((select (s ->> 'bones')::int from jsonb_array_elements(:'p'::jsonb -> 'steps') s where s ->> 'id' = 'global'), 15, 'The Global pays 15');
select throws_ok($$select public.starter_claim()$$, 'Finish your first week''s steps first.', 'Nothing to claim yet');
reset role;

-- Hound joins her to a Global on the first open: that one doesn't count.
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000c1', :'ann');
insert into public.global_auto_joins (user_id, challenge_id) values (:'ann', '00000000-0000-0000-0000-0000000000c1');
-- A fast and her step goal.
insert into public.fasts (user_id, goal_hours, started_at) values (:'ann', 16, now() - interval '2 hours');
insert into public.daily_step_totals (user_id, day, steps) values (:'ann', current_date, 12000);
select bones_balance as before from public.profiles where id = :'ann' \gset

select tests.sign_in(:'ann');
set local role authenticated;
select public.my_starter_path() as p \gset
select is((select jsonb_agg(x order by x) from jsonb_array_elements_text(:'p'::jsonb -> 'just_done') x), '["fast", "goal"]'::jsonb, 'The fast and the step goal tick');
select is((select bones_balance from public.profiles where id = :'ann') - :before, 20, '10 Bones each');
select is(public.my_starter_path() -> 'just_done', '[]'::jsonb, 'Paid once');
select is((select s -> 'done_at' from jsonb_array_elements(public.my_starter_path() -> 'steps') s where s ->> 'id' = 'global'), 'null'::jsonb,
  'An auto-joined Global doesn''t count');
select throws_ok($$select public.starter_skip('fast')$$, 'That one''s done already.', 'A done step can''t be skipped');
select is((public.starter_skip('move') -> 'steps' -> 2 ->> 'skipped')::boolean, true, 'Not for me');
reset role;

-- Joining one herself finishes it.
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000c2', :'ann');
select tests.sign_in(:'ann');
set local role authenticated;
select isnt(public.my_starter_path() -> 'finished_at', 'null'::jsonb, 'Every step left done: finished');
select is((public.starter_claim() ->> 'bones')::int, 15, 'The finish pays 15');
select ok(exists (select 1 from public.kennel_purchases k where k.user_id = :'ann' and k.item_id = 'bandana_starter'), 'And the Starter Bandana');
select is(public.my_starter_path() ->> 'show', 'false', 'Then the card goes');
reset role;

select tests.sign_in(:'boss');
set local role authenticated;
select is((public.admin_starter_overview() -> 'steps' -> 'move' ->> 'skipped')::int, 1, 'Admin sees the skip');
reset role;

select * from finish();
