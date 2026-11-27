-- 0275: Movement snacks and Move together.
select plan(24);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cy') as cy \gset
select tests.new_user('Boss', true) as boss \gset
insert into public.friendships (requester_id, recipient_id, status) values (:'ann', :'bob', 'accepted'), (:'ann', :'cy', 'accepted');
select (now() at time zone 'UTC')::date as today \gset

-- ── Snacks ──
select tests.sign_in(:'ann');
set local role authenticated;
select is((public.my_move_snacks(:'today') ->> 'enabled')::boolean, false, 'Snacks are off until you turn them on');
select lives_ok($$select public.move_snack_settings(true, '{morning,afternoon,teatime}')$$, 'Turned on, with windows');
select is(public.my_move_snacks(:'today') -> 'windows', '["afternoon", "morning"]'::jsonb, 'Unknown windows are dropped');
select public.move_snack_start(:'today', 'nudge') as s1 \gset
select is((:'s1'::jsonb ->> 'steps')::int, 250, 'A snack is 250 steps');
select is((public.move_snack_start(:'today') ->> 'id'), :'s1'::jsonb ->> 'id', 'One at a time: the open one comes back');
select throws_ok(format('select public.move_snack_finish(%L, 120)', :'s1'::jsonb ->> 'id'), 'Not there yet: 120 of 250 steps.', 'Not enough steps');
reset role;
-- It started 4 minutes ago.
update public.move_snacks set started_at = now() - interval '4 minutes' where id = (:'s1'::jsonb ->> 'id')::uuid;
set local role authenticated;
select throws_ok(format('select public.move_snack_finish(%L, 5000)', :'s1'::jsonb ->> 'id'), 'That''s more steps than fit in the time.', 'Too many steps for 4 minutes');
select is((public.move_snack_finish((:'s1'::jsonb ->> 'id')::uuid, 300) ->> 'bones')::int, 3, 'Done in time: 3 Bones');
select is((public.move_snack_finish((:'s1'::jsonb ->> 'id')::uuid, 300) ->> 'repeat')::boolean, true, 'Finishing twice pays once');
reset role;
select is((select bones_balance from public.profiles where id = :'ann') >= 3, true, 'Ann has the Bones');

-- Three paid a day, then they still count but pay nothing.
do $$ declare i int; s jsonb; begin
  for i in 1..3 loop
    s := public.move_snack_start((now() at time zone 'UTC')::date);
    update public.move_snacks set started_at = now() - interval '5 minutes' where id = (s ->> 'id')::uuid;
    perform public.move_snack_finish((s ->> 'id')::uuid, 260);
  end loop;
end $$;
-- (They all finish at the same now() inside the test, so sort by Bones.)
select is((select array_agg(bones order by bones desc) from public.move_snacks where user_id = :'ann'), '{3,3,3,0}'::int[], 'The fourth snack pays nothing');

-- Too late.
set local role authenticated;
select public.move_snack_start(:'today') as s5 \gset
reset role;
update public.move_snacks set started_at = now() - interval '20 minutes', expires_at = now() - interval '5 minutes' where id = (:'s5'::jsonb ->> 'id')::uuid;
set local role authenticated;
select throws_ok(format('select public.move_snack_finish(%L, 400)', :'s5'::jsonb ->> 'id'), 'Time ran out on that one. Try another!', 'Too late');
reset role;

-- ── Move together ──
set local role authenticated;
select throws_ok($$select public.move_pack_start('full10', '10-minute full body', 10, '{}')$$, 'Pick a friend to move with.', 'Needs a friend');
select public.move_pack_start('full10', '10-minute full body', 10, array[:'bob', :'cy', :'boss']::uuid[]) as pack \gset
reset role;
select is((select count(*)::int from public.move_pack_members where pack_id = :'pack'), 3, 'Ann and her two friends (not Boss, who isn''t one)');

select tests.sign_in(:'bob');
set local role authenticated;
select is(jsonb_array_length(public.move_pack_waiting()), 1, 'Bob is invited');
select lives_ok(format('select public.move_pack_join(%L)', :'pack'), 'Bob joins');
select is(jsonb_array_length(public.move_pack_waiting()), 0, 'and it leaves Needs you');
reset role;
select tests.sign_in(:'cy');
set local role authenticated;
select lives_ok(format('select public.move_pack_decline(%L)', :'pack'), 'Cy says not now');
reset role;

-- Both start their routine and Ann finishes.
select tests.sign_in(:'ann');
set local role authenticated;
select (public.move_session_start('routine', 'full10') ->> 'id') as ann_s \gset
select public.move_pack_began(:'pack', :'ann_s');
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
select (public.move_session_start('routine', 'full10') ->> 'id') as bob_s \gset
select public.move_pack_began(:'pack', :'bob_s');
reset role;
update public.move_sessions set started_at = now() - interval '11 minutes' where id in (:'ann_s', :'bob_s');
select tests.sign_in(:'ann');
set local role authenticated;
select public.move_session_finish(:'ann_s', 10, false, null, :'today') is not null as fin \gset
select is((public.move_pack_done(:'pack') ->> 'bones')::int, 0, 'Bob''s still going: no bonus yet');
select is((select jsonb_agg(x ->> 'state' order by x ->> 'state') from jsonb_array_elements(public.move_pack(:'pack') -> 'members') x),
  '["done", "going"]'::jsonb, 'Ann done, Bob going (Cy declined, not shown)');
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
select public.move_session_finish(:'bob_s', 10, false, null, :'today') is not null as fin2 \gset
select is((public.move_pack_done(:'pack') ->> 'bones')::int, 10, 'Both done: 10 Bones each');
reset role;
select is((select array_agg(bones order by user_id) from public.move_pack_members where pack_id = :'pack' and status = 'joined'), '{10,10}'::int[], 'Ann was paid too');

-- Admin.
select tests.sign_in(:'boss');
set local role authenticated;
select public.admin_move_social_overview() as o \gset
reset role;
select is((:'o'::jsonb ->> 'snacks_on')::int, 1, 'One with snacks on');
select is((:'o'::jsonb ->> 'packs_paid_7d')::int, 1, 'One Move together where everyone finished');

select * from finish();
