-- 0244: a Hound Chess game that ends early is settled at once. A
-- resignation ends the challenge now and pays the winner, once; a move
-- on a game still going doesn't.
select plan(6);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
update public.profiles set time_zone = 'America/New_York' where id in (:'ann', :'bob');
select public.soccer_today(:'ann') as today \gset
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-0000000c5e01', 'Quick one', 'chess', :'ann', 3, now() - interval '1 hour', now() + interval '3 days', :'today'::date);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000c5e01', :'ann');
select tests.sign_in(:'ann');
set local role authenticated;
select public.chess_setup('00000000-0000-0000-0000-0000000c5e01');
reset role;
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000c5e01', :'bob');

select tests.sign_in(:'ann');
set local role authenticated;
select public.chess_move('00000000-0000-0000-0000-0000000c5e01', 'e2', 'e4');
reset role;
select is((select score_settled_at from public.challenges where id = '00000000-0000-0000-0000-0000000c5e01'), null, 'A move in a game still going settles nothing');

select tests.sign_in(:'bob');
set local role authenticated;
select public.chess_resign('00000000-0000-0000-0000-0000000c5e01');
reset role;
select ok((select score_settled_at is not null and ends_at <= now() from public.challenges where id = '00000000-0000-0000-0000-0000000c5e01'), 'Bob resigns: it''s over and settled now');
select is((select score_points from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000c5e01' and user_id = :'ann'), 35, 'Ann gets the win');
select is((select bones_points from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000c5e01' and user_id = :'ann'), 30, 'and its Bones (25 and the usual 5)');
select public.settle_challenge_score('00000000-0000-0000-0000-0000000c5e01');
select public.chess_tick();
select is((select count(*)::int from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000c5e01'), 2, 'Paid once, whatever runs after');
select is((select bones_points from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000c5e01' and user_id = :'bob'), 5, 'Bob, the usual 5');

select * from finish();
