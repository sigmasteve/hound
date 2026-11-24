-- 0260: the players' looks under the chess clock, for the players only.
select plan(3);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select public.soccer_today(:'ann') as today \gset
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-000000260c01', 'Looks', 'chess', :'ann', 7, now() - interval '1 hour', now() + interval '7 days', :'today'::date);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-000000260c01', :'ann');
select tests.sign_in(:'ann');
set local role authenticated;
select public.chess_setup('00000000-0000-0000-0000-000000260c01');
reset role;
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-000000260c01', :'bob');

select tests.sign_in(:'ann');
set local role authenticated;
select is(public.chess_looks('00000000-0000-0000-0000-000000260c01') -> 'w' ->> 'initials', (select initials from public.profiles where id = :'ann'), 'White''s look is Ann''s');
select ok(public.chess_looks('00000000-0000-0000-0000-000000260c01') -> 'b' ? 'icon_id', 'Black''s look has an icon (or null)');
reset role;
select tests.sign_in(:'cat');
set local role authenticated;
select throws_ok($$select public.chess_looks('00000000-0000-0000-0000-000000260c01')$$, 'You''re not playing in this game.', 'Only the players');
reset role;

select * from finish();
