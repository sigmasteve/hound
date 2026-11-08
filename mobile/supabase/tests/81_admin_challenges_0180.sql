-- 0180: Admin's challenge numbers: running, upcoming, by kind and by
-- who made them; admins only.
select plan(10);

select tests.new_user('Ann', true) as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
-- The test database may already hold challenges from migrations; count from here.
select count(*) filter (where starts_at <= now() and ends_at > now()) as base_running,
  count(*) filter (where starts_at > now()) as base_upcoming from public.challenges \gset

insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, is_global, community, review_state, bingo_card_type) values
  ('00000000-0000-0000-0000-0000000000d1', 'Race', 'steps', :'bob', 7, now() - interval '1 day', now() + interval '6 days', false, false, null, null),
  ('00000000-0000-0000-0000-0000000000d2', 'Race 2', 'steps', :'cat', 7, now() - interval '1 day', now() + interval '6 days', false, false, null, null),
  ('00000000-0000-0000-0000-0000000000d3', 'Global bingo', 'bingo', :'ann', 7, now() - interval '1 day', now() + interval '6 days', true, false, null, 'hound'),
  ('00000000-0000-0000-0000-0000000000d4', 'Next week', 'streak', :'bob', 7, now() + interval '2 days', now() + interval '9 days', false, false, null, null),
  ('00000000-0000-0000-0000-0000000000d5', 'Taken down', 'steps', :'cat', 7, now() - interval '1 day', now() + interval '6 days', false, true, 'removed', null);
insert into public.challenge_participants (challenge_id, user_id) values
  ('00000000-0000-0000-0000-0000000000d1', :'bob'), ('00000000-0000-0000-0000-0000000000d1', :'cat'),
  ('00000000-0000-0000-0000-0000000000d2', :'cat'),
  ('00000000-0000-0000-0000-0000000000d3', :'ann');

select tests.sign_in(:'ann');
set local role authenticated;
select public.admin_challenges_overview() as o \gset
reset role;

select is((:'o'::jsonb ->> 'running')::int, :base_running + 3, 'Three running (the removed one doesn''t count)');
select is((:'o'::jsonb ->> 'upcoming')::int, :base_upcoming + 1, 'One coming up');
select ok((:'o'::jsonb ->> 'people_running')::int >= 3, 'Ann, Bob and Cat are in one');
select is((:'o'::jsonb -> 'by_source' -> 'global' ->> 'running')::int >= 1, true, 'A global one is running');
select is((select (k ->> 'running')::int from jsonb_array_elements(:'o'::jsonb -> 'by_kind') k where k ->> 'kind' = 'steps') >= 2, true,
  'Two Step Races running');
select is((select (k ->> 'people_running')::int from jsonb_array_elements(:'o'::jsonb -> 'by_kind') k where k ->> 'kind' = 'bingo') >= 1, true,
  'with people counted by kind');
select is(jsonb_array_length(:'o'::jsonb -> 'by_kind'), (select count(*)::int from unnest(enum_range(null::public.challenge_kind))), 'Every kind is listed');
select is(jsonb_array_length(:'o'::jsonb -> 'weekly'), 8, 'Eight weeks of new challenges');
select ok((:'o'::jsonb ->> 'created_7d')::int >= 4, 'Made this week');

select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok('select public.admin_challenges_overview()', 'not authorized', 'Admins only');
reset role;

select * from finish();
