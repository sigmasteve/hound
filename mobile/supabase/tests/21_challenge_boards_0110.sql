-- 0110: challenge_boards returns each challenge's participants with their
-- totals (and totals as of a day), plus its bots, only for challenges the
-- caller is in.
select plan(8);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select (current_date - 3) as d1, (current_date - 2) as d2, (current_date - 1) as d3 \gset
\set c1 '55555555-0000-0000-0000-000000000001'
\set c2 '55555555-0000-0000-0000-000000000002'

insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at) values
  ('55555555-0000-0000-0000-000000000001', 'Race', 'steps', :'ann', 7, now() - interval '4 days', now() + interval '3 days'),
  ('55555555-0000-0000-0000-000000000002', 'Not Ann''s', 'steps', :'cat', 7, now() - interval '4 days', now() + interval '3 days');
insert into public.challenge_participants (challenge_id, user_id) values
  ('55555555-0000-0000-0000-000000000001', :'ann'),
  ('55555555-0000-0000-0000-000000000001', :'bob'),
  ('55555555-0000-0000-0000-000000000002', :'cat');
insert into public.progress_snapshots (challenge_id, user_id, day, steps, distance_mi) values
  ('55555555-0000-0000-0000-000000000001', :'ann', :'d1', 5000, 2.5),
  ('55555555-0000-0000-0000-000000000001', :'ann', :'d3', 7000, 3.25),
  ('55555555-0000-0000-0000-000000000002', :'cat', :'d1', 9000, 4);
insert into public.challenge_bots (challenge_id, name, fitness_level) values
  ('55555555-0000-0000-0000-000000000001', 'Rover', 'active');

select tests.sign_in(:'ann');
set local role authenticated;

select is((select count(*)::int from public.challenge_boards(array[:'c1', :'c2']::uuid[], array[:'d2', null]::date[])),
  1, 'Only the challenge Ann is in comes back');
select is((select jsonb_array_length(participants) from public.challenge_boards(array[:'c1']::uuid[])),
  2, 'Both participants are listed');
select is((select (p->>'steps')::int from public.challenge_boards(array[:'c1']::uuid[]), jsonb_array_elements(participants) p
           where p->>'user_id' = :'ann'),
  12000, 'Ann''s steps are added up');
select is((select (p->>'distance_mi')::numeric from public.challenge_boards(array[:'c1']::uuid[]), jsonb_array_elements(participants) p
           where p->>'user_id' = :'ann'),
  5.75, 'and her miles');
select is((select (p->>'as_of_steps')::int from public.challenge_boards(array[:'c1']::uuid[], array[:'d2']::date[]), jsonb_array_elements(participants) p
           where p->>'user_id' = :'ann'),
  5000, 'Her steps as of a day only count days up to it');
select is((select p->'steps' from public.challenge_boards(array[:'c1']::uuid[]), jsonb_array_elements(participants) p
           where p->>'user_id' = :'bob'),
  'null'::jsonb, 'Someone with nothing logged has no total');
select is((select bots->0->>'name' from public.challenge_boards(array[:'c1']::uuid[])), 'Rover', 'The challenge''s bots come back');
reset role;

set local role anon;
select throws_ok('select * from public.challenge_boards(array[]::uuid[])', '42501', null, 'Signed-out callers can''t use it');
reset role;

select * from finish();
