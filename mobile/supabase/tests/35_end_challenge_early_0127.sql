-- 0127: a creator, or an admin for a global challenge, can make today a
-- challenge's last day. Today still counts; tomorrow doesn't.
select plan(10);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Zed', true) as zed \gset

\set TODAY '(now() at time zone ''utc'')::date'

-- Ann's 30-day Step Race, on its sixth day.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'Long race', 'steps', :'ann', 30,
  (:TODAY - 5)::timestamptz, (:TODAY - 5)::timestamptz + interval '30 days', :TODAY - 5);
insert into public.challenge_participants (challenge_id, user_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001', :'ann'), ('aaaaaaaa-0000-0000-0000-000000000001', :'bob');

select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok(format($q$select public.end_challenge_early('aaaaaaaa-0000-0000-0000-000000000001', %L)$q$, :TODAY),
  'P0001', 'Only the creator can end a challenge early.', 'Bob can''t end Ann''s race');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok(format($q$select public.end_challenge_early('aaaaaaaa-0000-0000-0000-000000000001', %L)$q$, :TODAY + 5),
  'P0001', 'That day doesn''t match today.', 'nor pass off another day as today');
select lives_ok(format($q$select public.end_challenge_early('aaaaaaaa-0000-0000-0000-000000000001', %L)$q$, :TODAY),
  'Ann ends it today');
select is((select duration_days from public.challenges where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 6, 'Six days long now');
select is((select ends_at from public.challenges where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  (:TODAY - 5)::timestamptz + interval '6 days', 'and it ends at the end of today');
select throws_ok(format($q$select public.end_challenge_early('aaaaaaaa-0000-0000-0000-000000000001', %L)$q$, :TODAY),
  'P0001', 'Today is already its last day.', 'Ending it again does nothing');
reset role;

-- Today's steps still count; tomorrow's are outside the challenge.
insert into public.progress_snapshots (challenge_id, user_id, day, steps, distance_mi)
values ('aaaaaaaa-0000-0000-0000-000000000001', :'bob', :TODAY, 4000, 2),
       ('aaaaaaaa-0000-0000-0000-000000000001', :'bob', :TODAY + 1, 9000, 4);
select is((select count(*)::int from public.progress_snapshots where challenge_id = 'aaaaaaaa-0000-0000-0000-000000000001' and user_id = :'bob'),
  1, 'Today''s steps count, tomorrow''s are skipped');

-- A global Bingo, published by Zed, that Ann (not an admin) can't end.
select tests.sign_in(:'zed');
set local role authenticated;
select public.publish_global_challenge('Bingo month', 'bingo', 30, now() - interval '1 day', now() + interval '10 days',
  null, null, null, null, 'hound', null) as global_id \gset
reset role;
update public.challenges set start_day = :TODAY - 1 where id = :'global_id';

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok(format($q$select public.end_challenge_early(%L, %L)$q$, :'global_id', :TODAY),
  'P0001', 'Only the creator can end a challenge early.', 'A player can''t end a global challenge');
reset role;

select tests.sign_in(:'zed');
set local role authenticated;
select lives_ok(format($q$select public.end_challenge_early(%L, %L)$q$, :'global_id', :TODAY), 'An admin can');
select ok((select join_closes_at <= ends_at from public.challenges where id = :'global_id'), 'and joining closes with it');
reset role;

select * from finish();
