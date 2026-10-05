-- 0096: personal challenges pay alone; one-player game-event challenges close.
select plan(4);

select tests.new_user('Dee') as dee \gset

-- A Bingo played alone, ended 30 hours ago. It pays for your own effort.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at)
values ('77777777-0000-0000-0000-000000000001', 'Solo Bingo', 'bingo', :'dee', 3, now() - interval '5 days', now() - interval '30 hours');
insert into public.challenge_participants (challenge_id, user_id) values ('77777777-0000-0000-0000-000000000001', :'dee');

select tests.sign_in(:'dee');
set local role authenticated;
select public.settle_challenge_score('77777777-0000-0000-0000-000000000001');
reset role;
select isnt((select score_settled_at from public.challenges where id = '77777777-0000-0000-0000-000000000001'),
  null, 'A solo Bingo settles');
select is((select count(*)::int from public.activity_events where challenge_id = '77777777-0000-0000-0000-000000000001' and user_id = :'dee'),
  1, 'A solo Bingo pays its player');

-- A Chase with one player, ended 30 hours ago: closed, nobody paid.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at)
values ('77777777-0000-0000-0000-000000000002', 'Lonely Chase', 'hunt', :'dee', 3, now() - interval '5 days', now() - interval '30 hours');
insert into public.challenge_participants (challenge_id, user_id) values ('77777777-0000-0000-0000-000000000002', :'dee');
select public.settle_due_challenges();
select isnt((select score_settled_at from public.challenges where id = '77777777-0000-0000-0000-000000000002'),
  null, 'The job closes a one-player Chase');
select is((select count(*)::int from public.activity_events where challenge_id = '77777777-0000-0000-0000-000000000002'),
  0, 'A one-player Chase pays nobody');

select * from finish();
