-- 0198: strength workouts and playing the real sport in the six sports
-- games. Strength minutes to bonuses, which workouts count for which
-- game, each engine's effect, the engines unchanged without a bonus,
-- sport_bonuses for the app, and Admin.
select plan(34);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select tests.new_user('Ada', true) as ada \gset
update public.profiles set time_zone = 'America/New_York' where id in (:'ann', :'bob', :'cat');

-- A workout at noon, New York time, on a day.
create function pg_temp.wk(p_user uuid, p_day date, p_name text, p_min int) returns void language sql as $$
  insert into public.workout_history (user_id, source_id, name, occurred_at, source, duration_min)
  values (p_user, gen_random_uuid()::text, p_name, (p_day::timestamp + interval '12 hours') at time zone 'America/New_York', 'Apple Health', p_min);
$$;

-- Strength minutes: 1 bonus at 15, 2 at 45, never more than 2.
select pg_temp.wk(:'cat', current_date - 30, 'Traditional Strength Training', 10);
select pg_temp.wk(:'cat', current_date - 29, 'Functional Strength Training', 15);
select pg_temp.wk(:'cat', current_date - 28, 'Traditional Strength Training', 44);
select pg_temp.wk(:'cat', current_date - 27, 'Core Training', 20);
select pg_temp.wk(:'cat', current_date - 27, 'Weightlifting', 25);
select pg_temp.wk(:'cat', current_date - 26, 'Traditional Strength Training', 120);
select is((select array_agg((select b.strength from public.sport_day_bonus(:'cat', current_date - k, 'hoops') b) order by k desc) from generate_series(26, 30) k),
  array[0, 1, 1, 2, 2], '10, 15, 44, 45 (two workouts) and 120 minutes of strength: 0, 1, 1, 2, 2 bonuses');

-- Which workouts count for which game.
select pg_temp.wk(:'cat', current_date - 20, 'American Football', 60);
select pg_temp.wk(:'cat', current_date - 19, 'Soccer', 30);
select pg_temp.wk(:'cat', current_date - 18, 'Tennis', 30);
select pg_temp.wk(:'cat', current_date - 17, 'Basketball', 15);
select is((select b.game_day from public.sport_day_bonus(:'cat', current_date - 20, 'soccer') b), false, 'American football isn''t soccer');
select is((select b.game_day from public.sport_day_bonus(:'cat', current_date - 19, 'soccer') b), true, '30 minutes of soccer is a Soccer game day');
select is((select b.game_day from public.sport_day_bonus(:'cat', current_date - 18, 'rally') b), true, 'Tennis counts for Rally');
select is((select b.game_day from public.sport_day_bonus(:'cat', current_date - 17, 'hoops') b), false, '15 minutes of basketball is short of a game day');
select is((select b.game_day::text || b.strength from public.sport_day_bonus(:'cat', current_date - 19, 'hoops') b), 'false0', 'and soccer is nothing in Hoops');

-- The latest day that's over everywhere (the engines' rule).
select (now() at time zone 'utc')::date
  - case when extract(hour from now() at time zone 'utc') >= 11 then 1 else 2 end as cutoff \gset

-- ── Hoops: Ann against Bob, 6,000 steps each (three shots apiece). On
-- day 1 Ann lifts for 50 minutes and plays 55 minutes of basketball.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-00000000aa01', 'Hoops', 'hoops', :'ann', 4,
   (:'cutoff'::date - 5)::timestamp at time zone 'utc', (:'cutoff'::date - 1)::timestamp at time zone 'utc', :'cutoff'::date - 5);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-00000000aa01', :'ann');
select tests.sign_in(:'ann');
set local role authenticated;
select public.hoops_setup('00000000-0000-0000-0000-00000000aa01', 2000, 1, false,
  ('[{"user_id":"' || :'ann' || '","team":"home"},{"user_id":"' || :'bob' || '","team":"away"}]')::jsonb);
reset role;
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-00000000aa01', :'bob');
insert into public.progress_snapshots (challenge_id, user_id, day, steps)
select '00000000-0000-0000-0000-00000000aa01', u, :'cutoff'::date - 5 + k, 6000
from unnest(array[:'ann'::uuid, :'bob'::uuid]) u cross join generate_series(0, 5) k;
select pg_temp.wk(:'ann', :'cutoff'::date - 5, 'Traditional Strength Training', 50);
select pg_temp.wk(:'ann', :'cutoff'::date - 5, 'Basketball', 55);

select tests.sign_in(:'ann');
set local role authenticated;
select cmp_ok(public.hoops_advance('00000000-0000-0000-0000-00000000aa01'), '>=', 4, 'The game plays');
select is((public.sport_bonuses('00000000-0000-0000-0000-00000000aa01', :'cutoff'::date - 5) -> 'players'
  -> (case when :'ann'::uuid < :'bob'::uuid then 0 else 1 end) ->> 'game_day')::boolean, true, 'sport_bonuses shows Ann''s game day');
select is(public.sport_bonuses('00000000-0000-0000-0000-00000000aa01') ->> 'sport', 'basketball', 'for basketball');
reset role;
select tests.sign_in(:'cat');
set local role authenticated;
select throws_ok($$select public.sport_bonuses('00000000-0000-0000-0000-00000000aa01')$$, 'not authorized', 'Someone outside the game can''t see it');
reset role;

select id as ann_seat from public.hoops_players where challenge_id = '00000000-0000-0000-0000-00000000aa01' and user_id = :'ann' \gset
select is((select count(*)::int from public.hoops_events where challenge_id = '00000000-0000-0000-0000-00000000aa01' and day_no = 1 and shooter = :'ann_seat' and kind not in ('ft', 'putback')),
  6, 'Day 1: three shots from steps, two for strength and one for the game day');
select is((select count(*)::int from public.hoops_events where challenge_id = '00000000-0000-0000-0000-00000000aa01' and day_no = 1 and shooter = :'ann_seat' and bonus = 'power'), 2, 'Two marked as power');
select is((select count(*)::int from public.hoops_events where challenge_id = '00000000-0000-0000-0000-00000000aa01' and day_no = 1 and shooter = :'ann_seat' and bonus = 'game_day'), 1, 'One marked as the game day''s');
select is((select count(*)::int from public.hoops_events where challenge_id = '00000000-0000-0000-0000-00000000aa01' and day_no = 2 and shooter = :'ann_seat' and kind not in ('ft', 'putback')),
  3, 'Day 2, no workouts: three shots');

-- Replaying day 1 three ways: the bonuses off (with her workouts there),
-- on with no workouts, and on with them. The first two are the same
-- plays, roll for roll; the third has more, and makes at least as many
-- of the same first three shots.
create temp table played (run text, seq int, shooter uuid, kind text, made boolean, pts int, rebound text, bonus text);
insert into played select 'with', e.seq, e.shooter, e.kind, e.made, e.pts, e.rebound, e.bonus
  from public.hoops_events e where e.challenge_id = '00000000-0000-0000-0000-00000000aa01' and e.day_no = 1;
delete from public.hoops_events where challenge_id = '00000000-0000-0000-0000-00000000aa01' and day_no = 1;
delete from public.hoops_days where challenge_id = '00000000-0000-0000-0000-00000000aa01' and day_no = 1;
update public.sport_bonus_config set enabled = false where id;
select public.hoops_play_day('00000000-0000-0000-0000-00000000aa01', :'cutoff'::date - 5, 1);
insert into played select 'off', e.seq, e.shooter, e.kind, e.made, e.pts, e.rebound, e.bonus
  from public.hoops_events e where e.challenge_id = '00000000-0000-0000-0000-00000000aa01' and e.day_no = 1;
delete from public.hoops_events where challenge_id = '00000000-0000-0000-0000-00000000aa01' and day_no = 1;
delete from public.hoops_days where challenge_id = '00000000-0000-0000-0000-00000000aa01' and day_no = 1;
update public.sport_bonus_config set enabled = true where id;
delete from public.workout_history where user_id = :'ann';
select public.hoops_play_day('00000000-0000-0000-0000-00000000aa01', :'cutoff'::date - 5, 1);
insert into played select 'none', e.seq, e.shooter, e.kind, e.made, e.pts, e.rebound, e.bonus
  from public.hoops_events e where e.challenge_id = '00000000-0000-0000-0000-00000000aa01' and e.day_no = 1;
select is((select count(*)::int from (
    (select seq, shooter, kind, made, pts, rebound, bonus from played where run = 'off' except select seq, shooter, kind, made, pts, rebound, bonus from played where run = 'none')
    union all
    (select seq, shooter, kind, made, pts, rebound, bonus from played where run = 'none' except select seq, shooter, kind, made, pts, rebound, bonus from played where run = 'off')) x),
  0, 'Off, or on with no workouts: the same plays');
select ok((select count(*) from played where run = 'with') > (select count(*) from played where run = 'none'), 'With her workouts, more plays');

-- ── Soccer: Ann up front for A, Bob up front for B; Ann has a strength
-- workout (40 minutes: one bonus) on the day.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-00000000aa02', 'Derby', 'soccer', :'ann', 3,
   (:'cutoff'::date - 1)::timestamp at time zone 'utc', (:'cutoff'::date + 2)::timestamp at time zone 'utc', :'cutoff'::date - 1);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-00000000aa02', :'ann');
select tests.sign_in(:'ann');
set local role authenticated;
select public.soccer_setup('00000000-0000-0000-0000-00000000aa02', 3000,
  ('[{"id":"' || :'ann' || '","team":"a","position":"forward"},{"id":"' || :'bob' || '","team":"b","position":"forward"}]')::jsonb);
reset role;
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-00000000aa02', :'bob');
insert into public.progress_snapshots (challenge_id, user_id, day, steps) values
  ('00000000-0000-0000-0000-00000000aa02', :'ann', :'cutoff'::date - 1, 6500), ('00000000-0000-0000-0000-00000000aa02', :'bob', :'cutoff'::date - 1, 6500);
select pg_temp.wk(:'ann', :'cutoff'::date - 1, 'Traditional Strength Training', 40);
select public.soccer_play_day('00000000-0000-0000-0000-00000000aa02', :'cutoff'::date - 1, 1, :'cutoff'::date - 1);
select is((select count(*)::int from public.soccer_events where challenge_id = '00000000-0000-0000-0000-00000000aa02' and shooter_id = :'ann'), 3, 'Soccer: two shots from steps and one for strength');
select is((select count(*)::int from public.soccer_events where challenge_id = '00000000-0000-0000-0000-00000000aa02' and shooter_id = :'bob'), 2, 'and two for Bob, who didn''t lift');
select is((select bonus from public.soccer_events where challenge_id = '00000000-0000-0000-0000-00000000aa02' and shooter_id = :'ann' and shot_no = 3), 'power', 'The third marked as power');

-- ── H-O-R-S-E: Ann sets a Three (10,000). She walks 7,000 and lifts for
-- 50 minutes (two bonuses: 4,000 more); Bob walks 7,000: a letter.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-00000000aa03', 'Driveway', 'horse', :'ann', 3,
   (:'cutoff'::date)::timestamp at time zone 'utc', (:'cutoff'::date + 3)::timestamp at time zone 'utc', :'cutoff'::date);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-00000000aa03', :'ann');
select tests.sign_in(:'ann');
set local role authenticated;
select public.horse_setup('00000000-0000-0000-0000-00000000aa03');
reset role;
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-00000000aa03', :'bob');
insert into public.progress_snapshots (challenge_id, user_id, day, steps) values
  ('00000000-0000-0000-0000-00000000aa03', :'ann', :'cutoff'::date, 7000), ('00000000-0000-0000-0000-00000000aa03', :'bob', :'cutoff'::date, 7000);
select pg_temp.wk(:'ann', :'cutoff'::date, 'Traditional Strength Training', 50);
select tests.sign_in(:'ann');
set local role authenticated;
select public.horse_advance('00000000-0000-0000-0000-00000000aa03');
reset role;
select is((select setter_steps from public.horse_days where challenge_id = '00000000-0000-0000-0000-00000000aa03' and day_no = 1), 11000, 'H-O-R-S-E: 7,000 steps and two strength bonuses make 11,000');
select is((select letter_to from public.horse_days where challenge_id = '00000000-0000-0000-0000-00000000aa03' and day_no = 1), :'bob', 'so she makes the Three and Bob takes a letter');

-- ── Cricket: one over a day, Ann against Bob; both lift on day 1.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-00000000aa04', 'Ashes', 'cricket', :'ann', 2,
   (:'cutoff'::date - 1)::timestamp at time zone 'utc', (:'cutoff'::date + 1)::timestamp at time zone 'utc', :'cutoff'::date - 1);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-00000000aa04', :'ann');
select tests.sign_in(:'ann');
set local role authenticated;
select public.cricket_setup('00000000-0000-0000-0000-00000000aa04', ('[{"id":"' || :'ann' || '","team":"a"},{"id":"' || :'bob' || '","team":"b"}]')::jsonb);
reset role;
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-00000000aa04', :'bob');
insert into public.progress_snapshots (challenge_id, user_id, day, steps)
select '00000000-0000-0000-0000-00000000aa04', u, :'cutoff'::date - 1 + k, 7000 from unnest(array[:'ann'::uuid, :'bob'::uuid]) u cross join generate_series(0, 1) k;
select pg_temp.wk(:'ann', :'cutoff'::date - 1, 'Traditional Strength Training', 50);
select pg_temp.wk(:'bob', :'cutoff'::date - 1, 'Traditional Strength Training', 50);
select tests.sign_in(:'ann');
set local role authenticated;
select is(public.cricket_advance('00000000-0000-0000-0000-00000000aa04'), 2, 'Cricket plays both days');
reset role;
select ok((select count(*) > 0 and count(*) = count(*) filter (where bonus = 'power') from public.cricket_balls where challenge_id = '00000000-0000-0000-0000-00000000aa04' and day_no = 1),
  'Day 1''s over is batted with power');
select ok(public.cricket_ball_outcome(0.6, 0.14, 1.5) = '6' and public.cricket_ball_outcome(0.6, 0.14) = '4', 'Power turns a four into a six on the same roll');
select ok(not exists (select 1 from generate_series(0, 99) k where public.cricket_ball_outcome(0.55, k / 100.0, 1) <> public.cricket_ball_outcome(0.55, k / 100.0)),
  'At a power of 1 it''s the old outcome on every roll');

-- ── Baseball: three innings, Ann against Bob; Ann lifts on day 1.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-00000000aa05', 'Opening Day', 'baseball', :'ann', 3,
   (:'cutoff'::date - 2)::timestamp at time zone 'utc', (:'cutoff'::date + 1)::timestamp at time zone 'utc', :'cutoff'::date - 2);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-00000000aa05', :'ann');
select tests.sign_in(:'ann');
set local role authenticated;
select public.baseball_setup('00000000-0000-0000-0000-00000000aa05', ('[{"id":"' || :'ann' || '","team":"a"},{"id":"' || :'bob' || '","team":"b"}]')::jsonb);
reset role;
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-00000000aa05', :'bob');
insert into public.progress_snapshots (challenge_id, user_id, day, steps)
select '00000000-0000-0000-0000-00000000aa05', u, :'cutoff'::date - 2 + k, 9000 from unnest(array[:'ann'::uuid, :'bob'::uuid]) u cross join generate_series(0, 2) k;
select pg_temp.wk(:'ann', :'cutoff'::date - 2, 'Traditional Strength Training', 50);
select tests.sign_in(:'ann');
set local role authenticated;
select cmp_ok(public.baseball_advance('00000000-0000-0000-0000-00000000aa05'), '>=', 1, 'Baseball plays');
reset role;
select is((select strength from public.sport_bonus_log where challenge_id = '00000000-0000-0000-0000-00000000aa05' and user_id = :'ann' and day = :'cutoff'::date - 2), 2,
  'Ann bats with two strength bonuses');

-- ── Rally: Bob has the shuttle and no steps, but lifted for 20 minutes
-- today: one power return, then he's short again.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at) values
  ('00000000-0000-0000-0000-00000000aa06', 'Shuttle run', 'rally', :'ann', 14, now() - interval '1 hour', now() + interval '13 days');
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-00000000aa06', :'ann');
select tests.sign_in(:'ann');
set local role authenticated;
select public.rally_setup('00000000-0000-0000-0000-00000000aa06', 1000, 4, null, array[:'bob']::uuid[]);
reset role;
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-00000000aa06', :'bob');
insert into public.workout_history (user_id, source_id, name, occurred_at, source, duration_min)
  values (:'bob', 'rally-lift', 'Traditional Strength Training', now() - interval '1 minute', 'Apple Health', 20);
select tests.sign_in(:'bob');
set local role authenticated;
select is(public.rally_check_shot('00000000-0000-0000-0000-00000000aa06'), 'returned', 'Rally: no steps, but a strength bonus sends it back');
reset role;
select is((select bonus from public.rally_events where challenge_id = '00000000-0000-0000-0000-00000000aa06' and user_id = :'bob' order by created_at desc limit 1), 'power', 'marked as a power return');
update public.rally_games set side_user_id = :'bob', side_team = (select team from public.rally_players where challenge_id = '00000000-0000-0000-0000-00000000aa06' and user_id = :'bob'),
  side_since = now() - interval '1 minute', side_start_total = 0, smash_armed = false where challenge_id = '00000000-0000-0000-0000-00000000aa06';
select tests.sign_in(:'bob');
set local role authenticated;
select is(public.rally_check_shot('00000000-0000-0000-0000-00000000aa06'), 'short', 'One a day: the next one is short');
reset role;

-- ── Admin.
select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok($$select public.admin_sport_bonus_overview()$$, 'not authorized', 'Only admins see the numbers');
select throws_ok($$select public.admin_set_sport_bonus_config('{"strength_max": 1}')$$, 'not authorized', 'or change them');
reset role;
select tests.sign_in(:'ada');
set local role authenticated;
select cmp_ok((public.admin_sport_bonus_overview() ->> 'strength_7d')::int, '>=', 2, 'Admin counts the strength bonuses used');
select public.admin_set_sport_bonus_config('{"strength_max": 1}');
reset role;
select is((select b.strength from public.sport_day_bonus(:'cat', current_date - 26, 'hoops') b), 1, 'and caps them');

select * from finish();
