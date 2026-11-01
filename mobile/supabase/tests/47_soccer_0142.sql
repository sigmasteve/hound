-- 0142: Soccer — line-ups with positions, only the named players join, a
-- day resolves once it's over everywhere with forwards shooting against
-- the other side's defense and keeper, every roll deterministic, the
-- match ends after its last day, and the winning side is paid.
select plan(29);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select tests.new_user('Dan') as dan \gset
select tests.new_user('Eve') as eve \gset

-- A three-day match that started two days ago: days 1 and 2 are over
-- everywhere, day 3 is today.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-0000000000c1', 'Derby', 'soccer', :'ann', 3,
   ((now() at time zone 'utc')::date - 2)::timestamp at time zone 'utc', ((now() at time zone 'utc')::date + 1)::timestamp at time zone 'utc',
   (now() at time zone 'utc')::date - 2);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000c1', :'ann');
insert into public.challenge_bots (id, challenge_id, name, fitness_level) values
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000c1', 'Blaze', 'elite');

select throws_ok(
  $$insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000c1', '$$ || :'bob' || $$')$$,
  null, null, 'Nobody joins before the line-ups are set');

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.soccer_setup('00000000-0000-0000-0000-0000000000c1', 3000, '[{"id":"$$ || :'ann' || $$","team":"b","position":"forward"},{"id":"$$ || :'bob' || $$","team":"a","position":"forward"}]'::jsonb)$$,
  null, null, 'The creator plays on team A');
select throws_ok($$select public.soccer_setup('00000000-0000-0000-0000-0000000000c1', 3000, '[{"id":"$$ || :'ann' || $$","team":"a","position":"forward"},{"id":"$$ || :'bob' || $$","team":"b","position":"keeper"},{"id":"$$ || :'cat' || $$","team":"b","position":"keeper"}]'::jsonb)$$,
  null, null, 'One keeper a team');
-- Ann (forward) and Cat (keeper) against Bob (forward), Dan (defender) and Blaze the bot (keeper).
select lives_ok($$select public.soccer_setup('00000000-0000-0000-0000-0000000000c1', 3000, '[
  {"id":"$$ || :'ann' || $$","team":"a","position":"forward"},
  {"id":"$$ || :'cat' || $$","team":"a","position":"keeper"},
  {"id":"$$ || :'bob' || $$","team":"b","position":"forward"},
  {"id":"$$ || :'dan' || $$","team":"b","position":"defender"},
  {"id":"00000000-0000-0000-0000-0000000000b5","team":"b","position":"keeper"}]'::jsonb)$$, 'The creator names both line-ups');
reset role;
select is((select count(*)::int from public.soccer_players where challenge_id = '00000000-0000-0000-0000-0000000000c1'), 5, 'Five seats');
select is((select joined from public.soccer_players where challenge_id = '00000000-0000-0000-0000-0000000000c1' and bot_id = '00000000-0000-0000-0000-0000000000b5'), true, 'The bot is in from the start');
select throws_ok(
  $$insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000c1', '$$ || :'eve' || $$')$$,
  null, null, 'Someone not named can''t join');
insert into public.challenge_participants (challenge_id, user_id) values
  ('00000000-0000-0000-0000-0000000000c1', :'bob'), ('00000000-0000-0000-0000-0000000000c1', :'cat'), ('00000000-0000-0000-0000-0000000000c1', :'dan');
select is((select count(*)::int from public.soccer_players where challenge_id = '00000000-0000-0000-0000-0000000000c1' and joined), 5, 'Everyone''s in');

-- Day 1: Ann walked 9,500 (three shots), Bob 2,000 (none), Dan 4,000.
insert into public.progress_snapshots (challenge_id, user_id, day, steps) values
  ('00000000-0000-0000-0000-0000000000c1', :'ann', (now() at time zone 'utc')::date - 2, 9500),
  ('00000000-0000-0000-0000-0000000000c1', :'bob', (now() at time zone 'utc')::date - 2, 2000),
  ('00000000-0000-0000-0000-0000000000c1', :'dan', (now() at time zone 'utc')::date - 2, 4000),
  ('00000000-0000-0000-0000-0000000000c1', :'cat', (now() at time zone 'utc')::date - 2, 6000);
-- Day 2: Bob walked 13,000 (four shots, the cap), Ann 3,100 (one).
insert into public.progress_snapshots (challenge_id, user_id, day, steps) values
  ('00000000-0000-0000-0000-0000000000c1', :'ann', (now() at time zone 'utc')::date - 1, 3100),
  ('00000000-0000-0000-0000-0000000000c1', :'bob', (now() at time zone 'utc')::date - 1, 13000),
  ('00000000-0000-0000-0000-0000000000c1', :'dan', (now() at time zone 'utc')::date - 1, 7000),
  ('00000000-0000-0000-0000-0000000000c1', :'cat', (now() at time zone 'utc')::date - 1, 5000);

select tests.sign_in(:'eve');
set local role authenticated;
select is(public.soccer_advance('00000000-0000-0000-0000-0000000000c1'), 0, 'Someone outside the match can''t advance it');
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
select is(public.soccer_advance('00000000-0000-0000-0000-0000000000c1'), 2, 'Two days were over everywhere and got played');
select is(public.soccer_advance('00000000-0000-0000-0000-0000000000c1'), 0, 'Playing again does nothing');
reset role;
select is((select days_played from public.soccer_games where challenge_id = '00000000-0000-0000-0000-0000000000c1'), 2, 'Day 2 is the latest played');
select is((select shots_a from public.soccer_days where challenge_id = '00000000-0000-0000-0000-0000000000c1' and day_no = 1), 3, '9,500 steps are three shots');
select is((select shots_b from public.soccer_days where challenge_id = '00000000-0000-0000-0000-0000000000c1' and day_no = 1), 0, '2,000 steps are no shot');
select is((select shots_b from public.soccer_days where challenge_id = '00000000-0000-0000-0000-0000000000c1' and day_no = 2), 4, 'Four shots a day is the cap');
select is((select count(*)::int from public.soccer_events where challenge_id = '00000000-0000-0000-0000-0000000000c1'), 8, 'Every shot is logged');
select ok((select bool_and(outcome in ('miss', 'saved', 'goal')) from public.soccer_events where challenge_id = '00000000-0000-0000-0000-0000000000c1'), 'Each shot missed, was saved or scored');
select is((select keeper_id from public.soccer_events where challenge_id = '00000000-0000-0000-0000-0000000000c1' and team = 'a' limit 1),
  '00000000-0000-0000-0000-0000000000b5', 'Ann''s shots face the bot in goal');
select is((select keeper_id from public.soccer_events where challenge_id = '00000000-0000-0000-0000-0000000000c1' and team = 'b' limit 1), :'cat', 'Bob''s shots face Cat');
select is((select goals_a + goals_b from public.soccer_games where challenge_id = '00000000-0000-0000-0000-0000000000c1'),
  (select count(*)::int from public.soccer_events where challenge_id = '00000000-0000-0000-0000-0000000000c1' and outcome = 'goal'), 'The score is the goals');
select is((select on_target_a - saves_b from public.soccer_days where challenge_id = '00000000-0000-0000-0000-0000000000c1' and day_no = 1),
  (select goals_a from public.soccer_days where challenge_id = '00000000-0000-0000-0000-0000000000c1' and day_no = 1), 'On target minus saved is goals');
select is((select status from public.soccer_games where challenge_id = '00000000-0000-0000-0000-0000000000c1'), 'active', 'Day 3 is still to play');

-- The same day plays the same way: a second match with the same ids and steps is identical.
select is(
  (select public.rally_js_rand(public.rally_js_hash('00000000-0000-0000-0000-0000000000c1:' || ((now() at time zone 'utc')::date - 2) || ':' || :'ann' || ':1:on'))),
  (select public.rally_js_rand(public.rally_js_hash('00000000-0000-0000-0000-0000000000c1:' || ((now() at time zone 'utc')::date - 2) || ':' || :'ann' || ':1:on'))),
  'Rolls are seeded');

-- Full time: move the match back a day so day 3 is over too.
update public.challenges set start_day = start_day - 1, starts_at = starts_at - interval '1 day', ends_at = ends_at - interval '1 day' where id = '00000000-0000-0000-0000-0000000000c1';
update public.soccer_days set day = day - 1 where challenge_id = '00000000-0000-0000-0000-0000000000c1';
select tests.sign_in(:'ann');
set local role authenticated;
select is(public.soccer_advance('00000000-0000-0000-0000-0000000000c1'), 1, 'The last day plays');
reset role;
select is((select status from public.soccer_games where challenge_id = '00000000-0000-0000-0000-0000000000c1'), 'final', 'Full time after the last day');
select is((select winner_team from public.soccer_games where challenge_id = '00000000-0000-0000-0000-0000000000c1'),
  (select case when goals_a > goals_b then 'a' when goals_b > goals_a then 'b' else null end from public.soccer_games where challenge_id = '00000000-0000-0000-0000-0000000000c1'),
  'The winner is whoever scored more, or nobody');
select tests.sign_in(:'ann');
set local role authenticated;
select public.settle_challenge_score('00000000-0000-0000-0000-0000000000c1');
reset role;
select is((select count(*)::int from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000000c1' and kind = 'soccer_result'), 4, 'The four people are paid, the bot isn''t');
select is((select score_points from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000000c1' and user_id = :'ann'),
  (select case when winner_team is null then 15 when winner_team = 'a' then 35 else 5 end from public.soccer_games where challenge_id = '00000000-0000-0000-0000-0000000000c1'),
  'Ann is paid by her side''s result');
select ok(exists (select 1 from cron.job where jobname = 'hound-soccer-advance'), 'The nightly job is scheduled');

select * from finish();
