-- 0145: Soccer tactics — the odds, who may pick what, picks hidden from
-- the other side until the day is played, picks flowing into the shots,
-- seeded picks for bots and no-shows, and the midday reminder.
select plan(25);

-- The odds.
select is(public.soccer_on_target_chance(9000, 3000), 0.5::double precision, 'On target: 0.2 + 0.4 x 9,000 / 12,000');
select is(round(public.soccer_save_chance(5000, 5000, 'top_left', null)::numeric, 4), 0.5250, 'No dive: the plain save chance');
select is(round(public.soccer_save_chance(5000, 5000, 'top_left', 'top_left')::numeric, 4), 0.8400, 'Right guess: 1.6 times');
select is(round(public.soccer_save_chance(5000, 5000, 'top_left', 'center')::numeric, 4), 0.4463, 'Wrong guess: 0.85 times');
select is(round(public.soccer_save_chance(10000, 1000, 'center', 'center')::numeric, 4), 0.9000, 'A right guess is capped at 90%');

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select tests.new_user('Dan') as dan \gset

-- Days 1 and 2 are over everywhere (the game's own cutoff); today, in
-- New York, is a later day still to play.
select (now() at time zone 'utc')::date
  - case when extract(hour from now() at time zone 'utc') >= 11 then 1 else 2 end as cutoff \gset

insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-0000000000c5', 'Tactics', 'soccer', :'ann', 6,
   (:'cutoff'::date - 1)::timestamp at time zone 'utc', (:'cutoff'::date + 5)::timestamp at time zone 'utc', :'cutoff'::date - 1);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000c5', :'ann');
insert into public.challenge_bots (id, challenge_id, name, fitness_level) values
  ('00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000c5', 'Blaze', 'elite');
-- Ann (forward) and Cat (keeper) against Bob (forward), Dan (defender) and Blaze (bot keeper).
select tests.sign_in(:'ann');
set local role authenticated;
select public.soccer_setup('00000000-0000-0000-0000-0000000000c5', 3000, ('[
  {"id":"' || :'ann' || '","team":"a","position":"forward"},
  {"id":"' || :'cat' || '","team":"a","position":"keeper"},
  {"id":"' || :'bob' || '","team":"b","position":"forward"},
  {"id":"' || :'dan' || '","team":"b","position":"defender"},
  {"id":"00000000-0000-0000-0000-0000000000b9","team":"b","position":"keeper"}]')::jsonb);
reset role;
insert into public.challenge_participants (challenge_id, user_id) values
  ('00000000-0000-0000-0000-0000000000c5', :'bob'), ('00000000-0000-0000-0000-0000000000c5', :'cat'), ('00000000-0000-0000-0000-0000000000c5', :'dan');

-- Who may pick what.
select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok($$select public.soccer_set_tactic('00000000-0000-0000-0000-0000000000c5', 'top_left')$$, 'A forward aims');
select throws_ok($$select public.soccer_set_tactic('00000000-0000-0000-0000-0000000000c5', 'the stands')$$, null, null, 'Only a corner or the centre');
reset role;
select tests.sign_in(:'cat');
set local role authenticated;
select lives_ok($$select public.soccer_set_tactic('00000000-0000-0000-0000-0000000000c5', 'bottom_right')$$, 'The keeper dives');
reset role;
select tests.sign_in(:'dan');
set local role authenticated;
select throws_ok($$select public.soccer_set_tactic('00000000-0000-0000-0000-0000000000c5', '$$ || :'cat' || $$')$$, null, null, 'A defender can''t mark the keeper');
select lives_ok($$select public.soccer_set_tactic('00000000-0000-0000-0000-0000000000c5', '$$ || :'ann' || $$')$$, 'A defender marks a forward');
select throws_ok('update public.soccer_tactics set mark_id = null', '42501', null, 'Nobody writes picks directly');
reset role;

-- Today's picks: your side sees them, the other side doesn't.
select tests.sign_in(:'bob');
set local role authenticated;
select is((select count(*)::int from public.soccer_tactics where challenge_id = '00000000-0000-0000-0000-0000000000c5'), 1, 'Bob sees only his side''s pick (Dan''s)');
reset role;
select tests.sign_in(:'ann');
set local role authenticated;
select is((select count(*)::int from public.soccer_tactics where challenge_id = '00000000-0000-0000-0000-0000000000c5'), 2, 'Ann sees her side''s two');
reset role;

-- Picks for days 1 and 2, and the steps.
insert into public.soccer_tactics (challenge_id, day, player_id, aim, dive, mark_id) values
  ('00000000-0000-0000-0000-0000000000c5', :'cutoff'::date - 1, :'ann', 'center', null, null),
  ('00000000-0000-0000-0000-0000000000c5', :'cutoff'::date - 1, :'dan', null, null, :'ann'),
  ('00000000-0000-0000-0000-0000000000c5', :'cutoff'::date, :'cat', null, 'top_right', null);
insert into public.progress_snapshots (challenge_id, user_id, day, steps) values
  ('00000000-0000-0000-0000-0000000000c5', :'ann', :'cutoff'::date - 1, 9500),
  ('00000000-0000-0000-0000-0000000000c5', :'dan', :'cutoff'::date - 1, 4000),
  ('00000000-0000-0000-0000-0000000000c5', :'bob', :'cutoff'::date, 13000),
  ('00000000-0000-0000-0000-0000000000c5', :'cat', :'cutoff'::date, 6000);

select tests.sign_in(:'bob');
set local role authenticated;
select is(public.soccer_advance('00000000-0000-0000-0000-0000000000c5'), 2, 'Days 1 and 2 are played');
reset role;

select is((select count(*)::int from public.soccer_events where challenge_id = '00000000-0000-0000-0000-0000000000c5' and day_no = 1 and team = 'a' and aim = 'center'),
  3, 'Ann''s three shots go where she aimed');
select ok((select bool_and(marker_ids = array[:'dan'::uuid]) from public.soccer_events where challenge_id = '00000000-0000-0000-0000-0000000000c5' and day_no = 1 and team = 'a'),
  'Ann''s shots carry Dan as her marker');
select ok((select bool_and(dive is not null) from public.soccer_events where challenge_id = '00000000-0000-0000-0000-0000000000c5' and day_no = 1 and team = 'a'),
  'The bot keeper picks a dive');
select ok((select bool_and(dive = 'top_right') from public.soccer_events where challenge_id = '00000000-0000-0000-0000-0000000000c5' and day_no = 2 and team = 'b'),
  'Bob''s shots face Cat''s dive');
select ok((select bool_and(aim is not null and marker_ids is null) from public.soccer_events where challenge_id = '00000000-0000-0000-0000-0000000000c5' and day_no = 2 and team = 'b'),
  'Bob didn''t pick: a seeded aim, and nobody marked him');

-- Once a day is played, both sides see its picks; today's stay hidden.
select tests.sign_in(:'bob');
set local role authenticated;
select is((select count(*)::int from public.soccer_tactics where challenge_id = '00000000-0000-0000-0000-0000000000c5' and day = :'cutoff'::date - 1), 2, 'Bob sees day 1''s picks from both sides');
select is((select count(*)::int from public.soccer_tactics where challenge_id = '00000000-0000-0000-0000-0000000000c5' and day > :'cutoff'::date), 1, 'Today''s are still hidden');
reset role;

-- The reminder: Bob is the only one without a pick today.
select is(public.soccer_pick_reminders(), 1, 'One player hasn''t picked');
select tests.sign_in(:'bob');
set local role authenticated;
select public.soccer_set_tactic('00000000-0000-0000-0000-0000000000c5', 'bottom_left');
reset role;
select is(public.soccer_pick_reminders(), 0, 'Everyone has picked');
select tests.sign_in(:'ann');
set local role authenticated;
select public.soccer_set_tactic('00000000-0000-0000-0000-0000000000c5', null);
reset role;
select is(public.soccer_pick_reminders(), 1, 'Clearing a pick brings the reminder back');
select ok(exists (select 1 from cron.job where jobname = 'hound-soccer-pick-reminders'), 'The reminder is scheduled');

select * from finish();
