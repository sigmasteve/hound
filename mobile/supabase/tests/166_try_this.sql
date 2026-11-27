-- 0281: Try this (Not now three times steps it aside a week) and Admin's numbers.
select plan(10);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Boss', true) as boss \gset
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at) values
  ('00000000-0000-0000-0000-0000000000b1', 'Office Chess', 'chess', :'ann', 7, now() - interval '1 day', now() + interval '6 days');
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000b1', :'ann');

select tests.sign_in(:'ann');
set local role authenticated;
select is(public.my_try_this() -> 'hidden_until', 'null'::jsonb, 'Showing to start with');
select is(public.my_try_this() -> 'played_kinds', '["chess"]'::jsonb, 'The kinds you''ve played');
select is((public.try_this_not_now() ->> 'not_nows')::int, 1, 'One Not now');
select is(public.try_this_not_now() -> 'hidden_until', 'null'::jsonb, 'Two: still showing');
select isnt(public.try_this_not_now() -> 'hidden_until', 'null'::jsonb, 'Three: steps aside');
select ok((public.my_try_this() ->> 'hidden_until')::timestamptz between now() + interval '6 days 23 hours' and now() + interval '7 days 1 minute', 'For a week');
select is((public.try_this_not_now() ->> 'not_nows')::int, 0, 'Not now while it''s aside counts nothing');
select public.note_today_tap('try_seen');
select public.note_today_tap('try_join');
select public.note_today_tap('hound_strip');
select throws_ok($$select public.admin_try_this_overview()$$, 'not authorized', 'Admin only');
reset role;

select tests.sign_in(:'boss');
set local role authenticated;
select public.admin_try_this_overview() as o \gset
select is((:'o'::jsonb ->> 'stepped_aside')::int, 1, 'One stepped aside');
select is(:'o'::jsonb -> 'taps_7d' -> 'try_join', '{"people": 1, "n": 1}'::jsonb, 'One joined from Try this');
reset role;

select * from finish();
