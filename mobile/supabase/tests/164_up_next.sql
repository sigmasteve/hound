-- 0279: Quiet this one, Play your turns' counts and Admin's Up next numbers.
select plan(11);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bo') as bo \gset
select tests.new_user('Boss', true) as boss \gset
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'Chess club', 'chess', :'ann', 7, now() - interval '1 day', now() + interval '6 days'),
  ('00000000-0000-0000-0000-0000000000a2', 'Old race', 'steps', :'ann', 7, now() - interval '9 days', now() - interval '2 days');
insert into public.challenge_participants (challenge_id, user_id) values
  ('00000000-0000-0000-0000-0000000000a1', :'ann'),
  ('00000000-0000-0000-0000-0000000000a2', :'ann');

select tests.sign_in(:'ann');
set local role authenticated;
select is(public.my_quiet_challenges(), '{}'::uuid[], 'Nothing quiet to start with');
select is(public.set_challenge_quiet('00000000-0000-0000-0000-0000000000a1', true), array['00000000-0000-0000-0000-0000000000a1']::uuid[], 'Quiet this one');
select is(public.set_challenge_quiet('00000000-0000-0000-0000-0000000000a1', true), array['00000000-0000-0000-0000-0000000000a1']::uuid[], 'Twice is the same');
select public.set_challenge_quiet('00000000-0000-0000-0000-0000000000a2', true);
select is(cardinality(public.my_quiet_challenges()), 2, 'Two quiet');
select is(public.set_challenge_quiet('00000000-0000-0000-0000-0000000000a2', false), array['00000000-0000-0000-0000-0000000000a1']::uuid[], 'Unquiet');
select public.set_challenge_quiet('00000000-0000-0000-0000-0000000000a2', true);
select public.note_today_tap('play_start');
select public.note_today_tap('play_turn');
select public.note_today_tap('play_turn');
select public.note_today_tap('play_done');
select throws_ok($$select public.admin_upnext_overview()$$, 'not authorized', 'Admin only');
reset role;

select tests.sign_in(:'bo');
set local role authenticated;
select throws_ok($$select public.set_challenge_quiet('00000000-0000-0000-0000-0000000000a1', true)$$,
  'You''re not in that challenge.', 'Only your own challenges');
select is(public.my_quiet_challenges(), '{}'::uuid[], 'Each person''s own');
reset role;

select tests.sign_in(:'boss');
set local role authenticated;
select public.admin_upnext_overview() as o \gset
select is((:'o'::jsonb ->> 'quiet_challenges')::int, 1, 'Only running challenges count as quiet');
select is(:'o'::jsonb -> 'taps_7d' -> 'play_turn', '{"people": 1, "n": 2}'::jsonb, 'Two turns opened from Play your turns');
select is((:'o'::jsonb ->> 'played_ever')::int, 1, 'One has played their turns');
reset role;

select * from finish();
