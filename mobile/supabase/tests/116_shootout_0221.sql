-- 0221: the Hound Shootout. The numbers (the green by spot and stage, too
-- soft / over / wide, the keeper's save chances and pace), publishing and
-- setup, joining, kicks from steps and the 20 cap, a goal the keeper went
-- the wrong way for (top bins 2, the golden ball double), the keeper
-- reading your habits, the board, the payout (ties share, the longest
-- scoring streak split, 15+ goals), and Admin.
select plan(50);

select tests.new_user('Ada', true) as ada \gset
select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select tests.new_user('Dan') as dan \gset
update public.profiles set time_zone = 'America/New_York' where id in (:'ann', :'bob', :'cat', :'dan');
select public.soccer_today(:'ann') as today \gset

-- ── The numbers ──

select is((select array_agg(public.shootout_width(z, 1) order by z) from generate_series(0, 5) z),
  array[7, 9, 7, 10, 13, 10]::numeric[], 'The green: top corners narrowest, low middle widest');
select is(public.shootout_width(0, 0.70), 4.90, 'and it narrows in the last third of the week');
select is(array[public.shootout_strike(0, 54, 1), public.shootout_strike(0, 55, 1), public.shootout_strike(0, 69, 1), public.shootout_strike(0, 70, 1)],
  array['held', 'on', 'on', 'over'], 'Top corner: under 55 too soft, over 69 over the bar');
select is(array[public.shootout_strike(3, 73, 1), public.shootout_strike(4, 76, 1), public.shootout_strike(4, 75, 1)],
  array['wide', 'over', 'on'], 'Low corners go wide, low middle goes over');
select is(public.shootout_strike(0, 67, 0.70), 'over', 'What was on target on day one is over the bar on the last day');
select is(array[public.shootout_save_chance(0, false, 0), public.shootout_save_chance(0, true, 0),
                public.shootout_save_chance(1, false, 0), public.shootout_save_chance(4, false, 0)],
  array[0.55, 0.15, 0.70, 0.95]::numeric[], 'Right way: top bins hardest to save, perfect even harder');
select is(array[public.shootout_save_chance(4, false, 1), public.shootout_save_chance(4, false, 2), public.shootout_save_chance(0, true, 2)],
  array[0.85, 0.75, 0.05]::numeric[], 'A workout''s pace: 10 off, 20 for two, never under 5%');
select is(public.shootout_keeper_lean(gen_random_uuid(), :'ann'), array[0.4, 0.2, 0.4]::numeric[], 'A keeper who hasn''t seen you leans to the corners');
select ok((select bool_and(public.shootout_golden_n(gen_random_uuid(), :'ann', :'today'::date) between 1 and 5) from generate_series(1, 30)),
  'The golden ball is one of your first five kicks');

-- ── Publishing and setting up ──

select tests.sign_in(:'ada');
set local role authenticated;
select throws_ok($q$select public.publish_global_challenge('Short Shootout', 'shootout', 2, now(), now() + interval '1 day')$q$,
  'The Hound Shootout runs 3 to 30 days.', 'A Shootout runs at least 3 days');
select public.publish_global_challenge('Hound Shootout', 'shootout', 7, now() - interval '1 hour', now() + interval '3 days') as so \gset
select ok(:'so' is not null, 'The Shootout can be a Global Hound Challenge');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok(format($q$select public.shootout_setup_global(%L)$q$, :'so'),
  'Only an admin can set up the Hound Shootout.', 'Only an admin sets it up');
select throws_ok(format($q$select public.join_global_challenge(%L)$q$, :'so'),
  'This Shootout isn''t set up yet.', 'Nobody joins before it''s set up');
reset role;

select tests.sign_in(:'ada');
set local role authenticated;
select throws_ok(format($q$select public.shootout_setup_global(%L, '{"places":[1,2],"top10":0,"streak":0,"fifteen":0}')$q$, :'so'),
  'Prizes need Bones for 1st, 2nd and 3rd.', 'Three places');
select lives_ok(format($q$select public.shootout_setup_global(%L)$q$, :'so'), 'The admin sets it up with the default prizes');
select throws_ok(format($q$select public.shootout_setup_global(%L)$q$, :'so'), 'This Shootout is already set up.', 'Once');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select public.join_global_challenge(:'so');
reset role;
select tests.sign_in(:'cat');
set local role authenticated;
select public.join_global_challenge(:'so');
reset role;
select tests.sign_in(:'dan');
set local role authenticated;
select public.join_global_challenge(:'so');
reset role;
select is((select joined_day from public.shootout_players where challenge_id = :'so' and user_id = :'ann'), :'today'::date,
  'Your Shootout counts from the day you join');

-- ── Kicks from steps ──

select tests.sign_in(:'ann');
set local role authenticated;
select is(public.shootout_live(:'so') ->> 'reason', 'No kicks ready: your next comes at 1,000 steps.', 'No steps, no kicks');
select throws_ok(format($q$select public.shootout_kick(%L, 0, 62)$q$, :'so'), 'No kicks ready: your next comes at 1,000 steps.', 'And no kick');
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
select is(public.shootout_live(:'so') ->> 'reason', 'Join the Shootout to kick.', 'Join first');
reset role;

insert into public.progress_snapshots (challenge_id, user_id, day, steps) values
  (:'so', :'ann', :'today', 4200), (:'so', :'cat', :'today', 25000), (:'so', :'dan', :'today', 20000);
-- Dan did an hour of strength work today.
insert into public.workout_history (user_id, source_id, name, occurred_at, source, duration_min)
  values (:'dan', 'shootout-test-1', 'Traditional Strength Training', (:'today'::date + time '12:00') at time zone 'America/New_York', 'test', 60);

select tests.sign_in(:'ann');
set local role authenticated;
select is((public.shootout_live(:'so') ->> 'kicks_left')::int, 4, '4,200 steps: four kicks');
select is(public.shootout_live(:'so') -> 'widths', '[7, 9, 7, 10, 13, 10]'::jsonb, 'Day one: the full green');
select throws_ok(format($q$select public.shootout_kick(%L, 6, 62)$q$, :'so'), 'Aim at one of the six spots.', 'Six spots');
select is(public.shootout_kick(:'so', 0, 20) - array['n', 'golden', 'dive', 'pace', 'total', 'goals', 'kicks', 'streak', 'best_streak', 'rank', 'kicks_left', 'golden_next', 'lean'],
  '{"zone":0,"power":20,"perfect":false,"result":"held","points":0,"message":"Too soft: the keeper holds it."}'::jsonb, 'Too soft: held');
select is(public.shootout_kick(:'so', 1, 95) ->> 'message', 'Too much on it: over the bar.', 'Too hard high: over the bar');
select is(public.shootout_kick(:'so', 5, 99) ->> 'message', 'Too much on it: wide of the post.', 'Too hard low in the corner: wide');
reset role;

-- Ann's fourth: aimed away from where the keeper is going (worked out the
-- way the server does), right on 62. A goal, in the top corner if he's not
-- diving that way.
select public.shootout_keeper_lean(:'so', :'ann') as lean \gset
select (case
    when r < (:'lean'::numeric[])[1] then 0
    when r < (:'lean'::numeric[])[1] + (:'lean'::numeric[])[2] then 1 else 2 end) as dive
  from (select public.derby_rand(:'so' || ':' || :'ann' || ':' || :'today' || ':4:dive') as r) x \gset
select case when :dive = 0 then 2 else 0 end as aim \gset
select (case when public.shootout_golden_n(:'so', :'ann', :'today'::date) = 4 then 4 else 2 end) as want \gset
select tests.sign_in(:'ann');
set local role authenticated;
select is((public.shootout_kick(:'so', :aim, 62) - array['n', 'zone', 'power', 'golden', 'dive', 'pace', 'goals', 'kicks', 'streak', 'best_streak', 'rank', 'kicks_left', 'golden_next', 'lean', 'message', 'total'])
  , jsonb_build_object('perfect', true, 'result', 'goal', 'points', :want),
  'He went the other way: top bins, 2 goals (4 on the golden ball)');
select is(public.shootout_live(:'so') ->> 'reason', 'No kicks ready: your next comes at 5,000 steps.', 'Four kicks used');
select is(public.shootout_live(:'so') -> 'me' ->> 'missed', '3', 'Three missed');
reset role;

-- ── Cat: the keeper learns, and the 20 cap ──

select tests.sign_in(:'cat');
set local role authenticated;
do $$
declare i int;
begin
  for i in 1 .. 20 loop
    perform public.shootout_kick((select id from public.challenges where name = 'Hound Shootout'), 3, 62);
  end loop;
end $$;
select is(public.shootout_live(:'so') ->> 'reason', 'That''s 20 kicks today. Back tomorrow.', '20 kicks a day at most');
select ok((public.shootout_live(:'so') -> 'keeper' -> 'lean' ->> 0)::numeric > 0.6, 'Twenty to the low left: the keeper leans left');
reset role;
select is((select count(*)::int from public.shootout_kicks where challenge_id = :'so' and user_id = :'cat' and result in ('goal', 'saved')), 20,
  'Right on 62 every time: always on target');
select ok((select bool_and(perfect) from public.shootout_kicks where challenge_id = :'so' and user_id = :'cat'), 'and perfect');
select is((select count(*)::int from public.shootout_kicks where challenge_id = :'so' and user_id = :'cat' and golden), 1, 'One golden ball a day');
select is((select points from public.shootout_players where challenge_id = :'so' and user_id = :'cat'),
  (select coalesce(sum(case when golden then 2 else 1 end), 0)::int from public.shootout_kicks where challenge_id = :'so' and user_id = :'cat' and result = 'goal'),
  'A low goal is 1, 2 on the golden ball');
select is((select best_streak >= cur_streak from public.shootout_players where challenge_id = :'so' and user_id = :'cat'), true, 'The streak is kept');

select tests.sign_in(:'dan');
set local role authenticated;
select is(public.shootout_live(:'so') -> 'pace', '{"cut": 20, "strength": 2}'::jsonb, 'Dan''s hour of strength: 20 off the keeper''s saves');
reset role;

-- ── The board ──

select tests.sign_in(:'ann');
set local role authenticated;
select is((public.shootout_board(:'so', 'top') ->> 'kicked')::int, 2, 'Two have kicked');
select ok(public.shootout_board(:'so', 'top') -> 'rows' -> 0 ? 'fav_zone', 'Each row has where they score most');
select throws_ok(format($q$select public.shootout_board(%L, 'nope')$q$, :'so'), 'Pick Top, Friends or My club.', 'A real tab');
reset role;

-- ── The end: places (a tie shares), the longest streak (split), 15+ ──

update public.shootout_players set points = 30, goals = 20, kicks = 20, best_streak = 9, best_streak_at = now()
  where challenge_id = :'so' and user_id = :'cat';
update public.shootout_players set points = 12, goals = 10, kicks = 12, best_streak = 9, best_streak_at = now()
  where challenge_id = :'so' and user_id = :'dan';
update public.shootout_players set points = 5, goals = 3, kicks = 4, best_streak = 2
  where challenge_id = :'so' and user_id = :'ann';
-- Bob joins late and ties Ann on goals and conversion.
insert into public.challenge_participants (challenge_id, user_id) values (:'so', :'bob');
update public.shootout_players set points = 5, goals = 3, kicks = 4, best_streak = 1
  where challenge_id = :'so' and user_id = :'bob';
select is((select array_agg(pos order by user_id) from public.shootout_positions(:'so') where user_id in (:'ann', :'bob')), array[3, 3],
  'Same goals, same conversion: the same place');
update public.challenges set starts_at = now() - interval '8 days', ends_at = now() - interval '25 hours' where id = :'so';
select public.settle_challenge_score(:'so');
set constraints all immediate;

select ok((select paid_at is not null from public.shootout_games where challenge_id = :'so'), 'It pays at the end');
select is((select array[place, place_bones, streak_bones, fifteen_bones] from public.shootout_players where challenge_id = :'so' and user_id = :'cat'),
  array[1, 500, 75, 25], 'Cat: 1st (500), half the streak prize (75), 15+ goals (25)');
select is((select array[place, place_bones, streak_bones, fifteen_bones] from public.shootout_players where challenge_id = :'so' and user_id = :'dan'),
  array[2, 300, 75, 0], 'Dan: 2nd, and the other half of the streak');
select is((select array_agg(place_bones order by user_id) from public.shootout_players where challenge_id = :'so' and user_id in (:'ann', :'bob')),
  array[150, 150], 'Ann and Bob tie for 3rd: 3rd and 4th shared, 150 each');
select is((select bones_points from public.activity_events where challenge_id = :'so' and user_id = :'cat' and kind = 'global_place'), 600,
  'Cat''s prize Bones in one go');
select public.shootout_pay(:'so');
select is((select count(*)::int from public.activity_events where challenge_id = :'so' and kind = 'global_place'), 4, 'Paid once');
select tests.sign_in(:'ann');
set local role authenticated;
select is(public.shootout_board(:'so', 'top') ->> 'status', 'final', 'The board says it''s over');
reset role;

-- ── Admin ──

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($q$select public.admin_shootout_overview()$q$, 'not authorized', 'Admins only');
reset role;
select tests.sign_in(:'ada');
set local role authenticated;
select is((public.admin_shootout_overview() ->> 'kicks_7d')::int, 24, 'Admin sees the kicks');
reset role;

select * from finish();
