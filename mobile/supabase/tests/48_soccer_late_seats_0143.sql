-- 0143: a Soccer creator can seat a friend after the match is made, with
-- the same team and keeper rules, and clear a seat nobody took up.
select plan(11);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select tests.new_user('Dan') as dan \gset

insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-0000000000c2', 'Late derby', 'soccer', :'ann', 9, now() - interval '1 hour', now() + interval '9 days', (now() at time zone 'utc')::date);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000c2', :'ann');
select tests.sign_in(:'ann');
set local role authenticated;
select public.soccer_setup('00000000-0000-0000-0000-0000000000c2', 3000, ('[{"id":"' || :'ann' || '","team":"a","position":"forward"},{"id":"' || :'bob' || '","team":"b","position":"keeper"}]')::jsonb);
reset role;

-- Without a seat, Cat can't accept an invite.
select throws_ok(
  $$insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000c2', '$$ || :'cat' || $$')$$,
  null, null, 'No seat, no joining');

select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok($$select public.soccer_add_player('00000000-0000-0000-0000-0000000000c2', '$$ || :'cat' || $$', 'b', 'defender')$$, null, null, 'Only the creator seats people');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.soccer_add_player('00000000-0000-0000-0000-0000000000c2', '$$ || :'cat' || $$', 'b', 'keeper')$$, null, null, 'Team B already has a keeper');
select lives_ok($$select public.soccer_add_player('00000000-0000-0000-0000-0000000000c2', '$$ || :'cat' || $$', 'b', 'defender')$$, 'Ann seats Cat as a defender on team B');
select throws_ok($$select public.soccer_add_player('00000000-0000-0000-0000-0000000000c2', '$$ || :'cat' || $$', 'a', 'forward')$$, null, null, 'One seat a person');
reset role;
select is((select joined from public.soccer_players where challenge_id = '00000000-0000-0000-0000-0000000000c2' and user_id = :'cat'), false, 'The seat waits for the accept');

insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000c2', :'cat');
select is((select joined from public.soccer_players where challenge_id = '00000000-0000-0000-0000-0000000000c2' and user_id = :'cat'), true, 'Accepting takes the seat');

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.soccer_remove_player('00000000-0000-0000-0000-0000000000c2', '$$ || :'cat' || $$')$$, null, null, 'A taken seat can''t be cleared');
select lives_ok($$select public.soccer_add_player('00000000-0000-0000-0000-0000000000c2', '$$ || :'dan' || $$', 'a', 'keeper')$$, 'Dan gets a seat');
select lives_ok($$select public.soccer_remove_player('00000000-0000-0000-0000-0000000000c2', '$$ || :'dan' || $$')$$, 'An untaken seat can be cleared');
reset role;
select is((select count(*)::int from public.soccer_players where challenge_id = '00000000-0000-0000-0000-0000000000c2'), 3, 'Three seats remain');

select * from finish();
