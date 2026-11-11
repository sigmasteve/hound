-- 0189: the Apple Watch pairs with a code, then acts as its person.
select plan(14);

select tests.new_user('Ann Lee') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Ada', true) as ada \gset
insert into public.water_goals (user_id, target_ml, glass_ml, units) values (:'ann', 1893, 250, 'cups');
insert into public.goals (user_id, metric, period, target) values (:'ann', 'steps', 'day', 10000);

-- The watch, signed out, asks for a code.
set local role anon;
select throws_ok($$select public.watch_pair_start('short')$$, 'That watch secret is too short.', 'The watch''s secret has to be long');
select public.watch_pair_start('0123456789abcdef0123456789abcdef-secret') as pair \gset
select is(char_length(:'pair'::jsonb->>'code'), 6, 'The watch gets a six-letter code');
select is((public.watch_pair_status((:'pair'::jsonb->>'device_id')::uuid, '0123456789abcdef0123456789abcdef-secret')->>'linked')::boolean, false, 'Not linked yet');
select throws_ok(format('select public.watch_today(%L, %L, current_date)', :'pair'::jsonb->>'device_id', '0123456789abcdef0123456789abcdef-secret'),
  'This watch isn''t linked. Open Hound on the watch for a code.', 'An unlinked watch gets nothing');
reset role;

-- Ann enters the code on her phone.
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.link_watch('ZZZZZZ')$$, 'That code doesn''t match a watch. Check the code on your watch, or open Hound on it again for a new one.', 'A wrong code is refused');
select is(public.link_watch(lower(:'pair'::jsonb->>'code')), (:'pair'::jsonb->>'device_id')::uuid, 'Her code links the watch');
select is(jsonb_array_length(public.my_watches()), 1, 'and it''s listed on her phone');
reset role;

set local role anon;
select is(public.watch_pair_status((:'pair'::jsonb->>'device_id')::uuid, '0123456789abcdef0123456789abcdef-secret')->>'name', 'Ann', 'The watch sees it''s linked, to Ann');
select throws_ok(format('select public.watch_today(%L, %L, current_date)', :'pair'::jsonb->>'device_id', 'the-wrong-secret-0123456789abcdef'),
  'This watch isn''t linked. Open Hound on the watch for a code.', 'The wrong secret gets nothing');
select is((public.watch_today((:'pair'::jsonb->>'device_id')::uuid, '0123456789abcdef0123456789abcdef-secret', current_date)->'goals'->0->>'target')::numeric, 10000::numeric, 'The watch reads Ann''s goals');
select is(public.watch_log_water((:'pair'::jsonb->>'device_id')::uuid, '0123456789abcdef0123456789abcdef-secret', current_date), 250, 'A tap adds her own glass size');
select is(public.watch_undo_water((:'pair'::jsonb->>'device_id')::uuid, '0123456789abcdef0123456789abcdef-secret', current_date), 0, 'and Undo takes it back');
reset role;

-- Ann unlinks it; the watch stops working.
select tests.sign_in(:'ann');
set local role authenticated;
select public.unlink_watch((:'pair'::jsonb->>'device_id')::uuid);
reset role;
set local role anon;
select throws_ok(format('select public.watch_today(%L, %L, current_date)', :'pair'::jsonb->>'device_id', '0123456789abcdef0123456789abcdef-secret'),
  'This watch isn''t linked. Open Hound on the watch for a code.', 'An unlinked watch stops working');
reset role;

select tests.sign_in(:'ada');
set local role authenticated;
select is((public.admin_watch_overview()->>'water_taps_7d')::int, 1, 'Admin counts water from the watch');
reset role;

select * from finish();
