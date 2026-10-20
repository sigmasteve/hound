-- 0118: a hound Bingo can only be joined from an app that sends the
-- hound-bingo feature header.
select plan(5);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset

insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, bingo_card_type) values
  ('00000000-0000-0000-0000-0000000000d1', 'New Bingo', 'bingo', :'ann', 28, now() - interval '2 hours', now() + interval '27 days', 'hound'),
  ('00000000-0000-0000-0000-0000000000d2', 'Old Bingo', 'bingo', :'ann', 7, now() - interval '2 hours', now() + interval '6 days', 'variety');

-- Not through the API (no request headers): allowed.
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000d1', :'ann');
select is((select count(*)::int from public.challenge_participants where challenge_id = '00000000-0000-0000-0000-0000000000d1'),
  1, 'Joins from outside the API go through');

-- An old app: headers, but no feature tag.
select set_config('request.headers', '{"user-agent": "okhttp"}', true);
select throws_ok(
  format('insert into public.challenge_participants (challenge_id, user_id) values (%L, %L)', '00000000-0000-0000-0000-0000000000d1', :'bob'),
  'Update Hound to join this Bingo: it needs the latest version of the app.',
  'An old app can''t join a hound Bingo');
select lives_ok(
  format('insert into public.challenge_participants (challenge_id, user_id) values (%L, %L)', '00000000-0000-0000-0000-0000000000d2', :'bob'),
  'An old app can still join an old-style Bingo');

-- The new app.
select set_config('request.headers', '{"x-hound-features": "hound-bingo"}', true);
select lives_ok(
  format('insert into public.challenge_participants (challenge_id, user_id) values (%L, %L)', '00000000-0000-0000-0000-0000000000d1', :'bob'),
  'The new app joins');
select is((select count(*)::int from public.bingo_cards where challenge_id = '00000000-0000-0000-0000-0000000000d1' and user_id = :'bob'),
  1, 'and gets a card');

select * from finish();
