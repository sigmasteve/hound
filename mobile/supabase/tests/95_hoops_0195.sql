-- 0195: Hoops — setup, bots, late joins, shots from steps, picks and
-- votes, a seeded game with dunks, fouls and rebounds, overtime on a tie,
-- settlement and Admin.
select plan(40);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select tests.new_user('Dan') as dan \gset
select tests.new_user('Eve') as eve \gset
select tests.new_user('Ada', true) as ada \gset

-- Usual days, for the matchups: Ann 12,000, Cat 9,000, Bob 8,000, Dan
-- 2,000 (bots 7,000). So Ann guards Cat and Bob a bot.
insert into public.daily_step_totals (user_id, day, steps) values
  (:'ann', current_date - 1, 12000), (:'bob', current_date - 1, 8000), (:'cat', current_date - 1, 9000), (:'dan', current_date - 1, 2000);

-- The latest day that's over everywhere (hoops_advance's rule).
select (now() at time zone 'utc')::date
  - case when extract(hour from now() at time zone 'utc') >= 11 then 1 else 2 end as cutoff \gset

-- A four-day game whose days (and two spare overtime days) are all over.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-0000000000a1', 'Friday Night Hoops', 'hoops', :'ann', 4,
   (:'cutoff'::date - 5)::timestamp at time zone 'utc', (:'cutoff'::date - 1)::timestamp at time zone 'utc', :'cutoff'::date - 5);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000a1', :'ann');

select throws_ok($$insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000a1', '$$ || :'bob' || $$')$$,
  'This game isn''t set up yet.', 'Nobody else joins before setup');

select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok($$select public.hoops_setup('00000000-0000-0000-0000-0000000000a1', 2000, 1, true, '[]'::jsonb)$$,
  'Only whoever made this game can set it up.', 'Only the creator sets it up');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.hoops_setup('00000000-0000-0000-0000-0000000000a1', 2000, 2, true, '[{"user_id":"$$ || :'ann' || $$","team":"home"}]'::jsonb)$$,
  'A game is four quarters: 8 days.', 'Two days a quarter needs eight days');
select throws_ok($$select public.hoops_setup('00000000-0000-0000-0000-0000000000a1', 1800, 1, true, '[{"user_id":"$$ || :'ann' || $$","team":"home"}]'::jsonb)$$,
  'A shot is 1,500, 2,000, 2,500 or 3,000 steps.', 'Shot sizes are set');
select throws_ok($$select public.hoops_setup('00000000-0000-0000-0000-0000000000a1', 2000, 1, false, '[{"user_id":"$$ || :'ann' || $$","team":"home"}]'::jsonb)$$,
  'The other side needs someone: invite a friend or fill it with bots.', 'An empty other side needs bots');
select lives_ok($$select public.hoops_setup('00000000-0000-0000-0000-0000000000a1', 2000, 1, true,
  '[{"user_id":"$$ || :'ann' || $$","team":"home"},{"user_id":"$$ || :'bob' || $$","team":"home"},{"user_id":"$$ || :'cat' || $$","team":"away"}]'::jsonb)$$,
  'Ann sets it up: Ann and Bob against Cat, bots filling both sides');
reset role;

select is((select count(*)::int from public.hoops_players where challenge_id = '00000000-0000-0000-0000-0000000000a1'), 10, 'Five a side');
select is((select count(*)::int from public.hoops_players where challenge_id = '00000000-0000-0000-0000-0000000000a1' and bot_id is not null), 7, 'Seven of them bots');
select is((select count(*)::int from public.hoops_players where challenge_id = '00000000-0000-0000-0000-0000000000a1' and guarding is null), 0, 'Everyone guards someone');

insert into public.challenge_participants (challenge_id, user_id) values
  ('00000000-0000-0000-0000-0000000000a1', :'bob'), ('00000000-0000-0000-0000-0000000000a1', :'cat');
select is((select joined from public.hoops_players where challenge_id = '00000000-0000-0000-0000-0000000000a1' and user_id = :'bob'), true, 'Bob takes his seat');

-- Dan joins late: onto the side with fewer people, in a bot's seat.
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000a1', :'dan');
select is((select team from public.hoops_players where challenge_id = '00000000-0000-0000-0000-0000000000a1' and user_id = :'dan'), 'away', 'Dan joins the side with fewer people');
select is((select count(*)::int from public.hoops_players where challenge_id = '00000000-0000-0000-0000-0000000000a1' and team = 'away'), 5, 'replacing a bot');

-- Picks.
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.hoops_set_shot('00000000-0000-0000-0000-0000000000a1', 'hook')$$, 'Pick a drive, a mid-range or a three.', 'Only three shots');
select lives_ok($$select public.hoops_set_shot('00000000-0000-0000-0000-0000000000a1', 'drive')$$, 'Ann drives');
select lives_ok($$select public.hoops_vote('00000000-0000-0000-0000-0000000000a1', 'arc')$$, 'and votes to guard the arc today');
select is(public.hoops_view('00000000-0000-0000-0000-0000000000a1') ->> 'my_vote', 'arc', 'Her vote shows');
select is((public.hoops_view('00000000-0000-0000-0000-0000000000a1') -> 'team_votes' ->> 'arc')::int, 1, 'and her side''s count');
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
select lives_ok($$select public.hoops_set_shot('00000000-0000-0000-0000-0000000000a1', 'three')$$, 'Bob shoots threes');
reset role;
select tests.sign_in(:'eve');
set local role authenticated;
select throws_ok($$select public.hoops_view('00000000-0000-0000-0000-0000000000a1')$$, 'not authorized', 'Someone outside the game can''t see it');
reset role;

-- Cat's side packs the paint on day 1 (a vote from before the day).
insert into public.hoops_votes (challenge_id, day, user_id, team, choice) values
  ('00000000-0000-0000-0000-0000000000a1', :'cutoff'::date - 5, :'cat', 'away', 'paint');

-- Steps: Ann 20,000 a day (five shots, dunks, and twice her defender's),
-- Bob 9,000, Cat 6,500, Dan 1,500 (no shot).
insert into public.progress_snapshots (challenge_id, user_id, day, steps)
select '00000000-0000-0000-0000-0000000000a1', u, :'cutoff'::date - 5 + k, s
from (values (:'ann'::uuid, 20000), (:'bob'::uuid, 9000), (:'cat'::uuid, 6500), (:'dan'::uuid, 1500)) v(u, s)
cross join generate_series(0, 5) k;

select tests.sign_in(:'bob');
set local role authenticated;
select cmp_ok(public.hoops_advance('00000000-0000-0000-0000-0000000000a1'), '>=', 4, 'The four quarters get played');
reset role;

select is((select count(*)::int from public.hoops_events where challenge_id = '00000000-0000-0000-0000-0000000000a1' and shooter =
  (select id from public.hoops_players where challenge_id = '00000000-0000-0000-0000-0000000000a1' and user_id = :'dan')), 0, '1,500 steps are no shot');
select is((select count(*)::int from public.hoops_events where challenge_id = '00000000-0000-0000-0000-0000000000a1' and day_no = 1 and kind <> 'putback' and shooter =
  (select id from public.hoops_players where challenge_id = '00000000-0000-0000-0000-0000000000a1' and user_id = :'bob')), 4, '9,000 steps are four shots');
select is((select count(*)::int from public.hoops_events where challenge_id = '00000000-0000-0000-0000-0000000000a1' and day_no = 1 and kind = 'ft' and shooter =
  (select id from public.hoops_players where challenge_id = '00000000-0000-0000-0000-0000000000a1' and user_id = :'ann')), 2,
  'Twice her defender''s steps: Ann''s first shot is two free throws');
select ok((select count(*) from public.hoops_events where challenge_id = '00000000-0000-0000-0000-0000000000a1' and dunk) > 0, 'Ann dunks');
select ok((select count(*) from public.hoops_events where challenge_id = '00000000-0000-0000-0000-0000000000a1' and rebound is not null) > 0, 'Misses are rebounded');
select ok(not exists (
  select 1 from public.hoops_events e
  where e.challenge_id = '00000000-0000-0000-0000-0000000000a1' and e.on_fire
    and (select count(*) filter (where p.made) from (
          select x.made from public.hoops_events x
          where x.challenge_id = e.challenge_id and x.day = e.day and x.shooter = e.shooter and x.kind <> 'ft' and x.seq < e.seq
          order by x.seq desc limit 3) p) < 3), 'On fire only after three makes in a row');
select is(round((public.hoops_chance('mid', 5000, 5000, 'paint', false, true) - public.hoops_chance('mid', 5000, 5000, 'paint', false, false))::numeric, 2), 0.08, 'and worth +0.08');
select is((select defense_away from public.hoops_days where challenge_id = '00000000-0000-0000-0000-0000000000a1' and day_no = 1), 'paint', 'The away side''s vote set its defense');
select is((select score_home from public.hoops_games where challenge_id = '00000000-0000-0000-0000-0000000000a1'),
  (select coalesce(sum(pts), 0)::int from public.hoops_events where challenge_id = '00000000-0000-0000-0000-0000000000a1' and team = 'home'), 'The score is the sum of the shots');
select is((select status from public.hoops_games where challenge_id = '00000000-0000-0000-0000-0000000000a1'), 'final', 'and the game ends');

select tests.sign_in(:'ann');
set local role authenticated;
select is(jsonb_array_length(public.hoops_view('00000000-0000-0000-0000-0000000000a1') -> 'line'), 4 + greatest(0, (select days_played from public.hoops_games where challenge_id = '00000000-0000-0000-0000-0000000000a1') - 4),
  'The line score has every period');
reset role;

-- Paid: winners get the win Bones on top, everyone the play Bones.
select public.settle_challenge_score('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000000a1' and kind = 'hoops_result'), 4, 'Every person who played is paid');
select is((select bones_points from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000000a1' and user_id = :'ann'),
  case when (select winner_team from public.hoops_games where challenge_id = '00000000-0000-0000-0000-0000000000a1') = 'home' then 55
       when (select winner_team from public.hoops_games where challenge_id = '00000000-0000-0000-0000-0000000000a1') is null then 15 else 15 end,
  'Win Bones for the winners, play Bones for all');

-- Nobody walks: level after four quarters, then three overtimes, then a tie.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-0000000000a2', 'Quiet', 'hoops', :'ann', 4,
   (:'cutoff'::date - 7)::timestamp at time zone 'utc', (:'cutoff'::date - 3)::timestamp at time zone 'utc', :'cutoff'::date - 7);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000a2', :'ann');
select tests.sign_in(:'ann');
set local role authenticated;
select public.hoops_setup('00000000-0000-0000-0000-0000000000a2', 2000, 1, false,
  ('[{"user_id":"' || :'ann' || '","team":"home"},{"user_id":"' || :'eve' || '","team":"away"}]')::jsonb);
reset role;
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000a2', :'eve');
select public.hoops_advance('00000000-0000-0000-0000-0000000000a2');
select is((select days_played from public.hoops_games where challenge_id = '00000000-0000-0000-0000-0000000000a2'), 7, 'A tie plays overtime, three at most');
select is((select label from public.hoops_days where challenge_id = '00000000-0000-0000-0000-0000000000a2' and day_no = 5), 'OT', 'The first is OT');
select ok((select status = 'final' and winner_team is null from public.hoops_games where challenge_id = '00000000-0000-0000-0000-0000000000a2'), 'then it''s a tie');

-- Admin.
select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok($$select public.admin_hoops_overview()$$, 'not authorized', 'Only admins see the numbers');
select throws_ok($$select public.admin_set_hoops_config('{"win_bones": 500}')$$, 'not authorized', 'or change the Bones');
reset role;
select tests.sign_in(:'ada');
set local role authenticated;
select is((public.admin_hoops_overview() ->> 'hoops_all')::int, 2, 'Admin counts the games');
select public.admin_set_hoops_config('{"win_bones": 60}');
select is((select win_bones from public.hoops_config), 60, 'and sets the win Bones');
reset role;

select * from finish();
