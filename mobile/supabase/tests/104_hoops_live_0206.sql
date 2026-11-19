-- 0206: Hoops, take your own shots. Shots earned from steps so far, the
-- make window and the defender, how a release moves the chance, the
-- seeded roll, when you can't shoot, the putback, the day played with
-- live shots first and the rest rolled, hands-off games as before, the
-- view, the plays' by_hand, and Admin.
select plan(46);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select tests.new_user('Ada', true) as ada \gset
update public.profiles set time_zone = 'America/New_York' where id in (:'ann', :'bob', :'cat');
select public.soccer_today(:'ann') as today \gset

-- Three games, Ann (home) against Bob (away): A hands-on and on its
-- second day today, B the same but hands-off, C hands-on and long over.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-00000000b601', 'Hands on', 'hoops', :'ann', 4,
   (:'today'::date - 1)::timestamp at time zone 'America/New_York', (:'today'::date + 3)::timestamp at time zone 'America/New_York', :'today'::date - 1),
  ('00000000-0000-0000-0000-00000000b602', 'Hands off', 'hoops', :'ann', 4,
   (:'today'::date - 1)::timestamp at time zone 'America/New_York', (:'today'::date + 3)::timestamp at time zone 'America/New_York', :'today'::date - 1),
  ('00000000-0000-0000-0000-00000000b603', 'Long ago', 'hoops', :'ann', 4,
   (:'today'::date - 10)::timestamp at time zone 'America/New_York', (:'today'::date - 6)::timestamp at time zone 'America/New_York', :'today'::date - 10);
insert into public.challenge_participants (challenge_id, user_id)
select g, :'ann' from unnest(array['00000000-0000-0000-0000-00000000b601', '00000000-0000-0000-0000-00000000b602', '00000000-0000-0000-0000-00000000b603']::uuid[]) g;

select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok($$select public.hoops_setup('00000000-0000-0000-0000-00000000b601', 2000, 1, false,
  '[{"user_id":"$$ || :'ann' || $$","team":"home"},{"user_id":"$$ || :'bob' || $$","team":"away"}]'::jsonb, p_hands_on => true)$$,
  'hoops_setup takes p_hands_on');
select lives_ok($$select public.hoops_setup('00000000-0000-0000-0000-00000000b602', 2000, 1, false,
  '[{"user_id":"$$ || :'ann' || $$","team":"home"},{"user_id":"$$ || :'bob' || $$","team":"away"}]'::jsonb)$$,
  'and the old call still works');
select public.hoops_setup('00000000-0000-0000-0000-00000000b603', 2000, 1, false,
  ('[{"user_id":"' || :'ann' || '","team":"home"},{"user_id":"' || :'bob' || '","team":"away"}]')::jsonb, 'Hounds', 'Strays', true);
reset role;
insert into public.challenge_participants (challenge_id, user_id)
select g, :'bob' from unnest(array['00000000-0000-0000-0000-00000000b601', '00000000-0000-0000-0000-00000000b602', '00000000-0000-0000-0000-00000000b603']::uuid[]) g;

select is((select array_agg(hands_on order by challenge_id) from public.hoops_games
  where challenge_id in ('00000000-0000-0000-0000-00000000b601', '00000000-0000-0000-0000-00000000b602', '00000000-0000-0000-0000-00000000b603')),
  array[true, false, true], 'hands_on is set from Create, off by default');

-- Today so far: Ann 1,500 steps, Bob 3,000.
insert into public.progress_snapshots (challenge_id, user_id, day, steps)
select g, u, :'today'::date, s
from unnest(array['00000000-0000-0000-0000-00000000b601', '00000000-0000-0000-0000-00000000b602', '00000000-0000-0000-0000-00000000b603']::uuid[]) g
cross join (values (:'ann'::uuid, 1500), (:'bob'::uuid, 3000)) v(u, s);

create function pg_temp.steps(p_user uuid, p_steps int) returns void language sql as $$
  update public.progress_snapshots set steps = p_steps where user_id = p_user and day = public.soccer_today(p_user);
$$;

-- ── Shots earned from steps ──
select tests.sign_in(:'ann');
set local role authenticated;
select is(public.hoops_live('00000000-0000-0000-0000-00000000b601') - 'windows' - 'defender' - 'shots' - 'day' - 'their_defense',
  jsonb_build_object('hands_on', true, 'can_shoot', false, 'reason', 'No shots ready: your next one comes at 2,000 steps.',
    'day_no', 2, 'period', 2, 'label', 'Q2', 'steps', 1500, 'shot_steps', 2000, 'earned', 0, 'taken', 0, 'ready', 0,
    'next_at', 2000, 'streak', 0, 'today_pts', 0),
  '1,500 steps: no shots yet, the first at 2,000');
select throws_ok($$select public.hoops_take_shot('00000000-0000-0000-0000-00000000b601', 'mid', 0)$$,
  'No shots ready: your next one comes at 2,000 steps.', 'and none to take');
reset role;

select pg_temp.steps(:'ann', 8000);
select tests.sign_in(:'ann');
set local role authenticated;
select is((select jsonb_build_object('earned', l -> 'earned', 'ready', l -> 'ready', 'next_at', l -> 'next_at', 'can_shoot', l -> 'can_shoot', 'defender', l -> 'defender')
           from public.hoops_live('00000000-0000-0000-0000-00000000b601') l),
  jsonb_build_object('earned', 4, 'ready', 4, 'next_at', 10000, 'can_shoot', true, 'defender', jsonb_build_object('name', 'Bob', 'steps', 3000)),
  '8,000 steps: four shots ready, the next at 10,000, Bob guarding with 3,000');

-- ── The make window ──
select is(public.hoops_live('00000000-0000-0000-0000-00000000b601') -> 'windows',
  '{"drive": 0.36, "mid": 0.26, "three": 0.2}'::jsonb, 'Walking more than your defender: the full windows');
reset role;
select pg_temp.steps(:'bob', 12000);
select tests.sign_in(:'ann');
set local role authenticated;
select is(public.hoops_live('00000000-0000-0000-0000-00000000b601') -> 'windows',
  '{"drive": 0.24, "mid": 0.173, "three": 0.133}'::jsonb, 'A defender with 12,000 to your 8,000 narrows them by a third');
reset role;
select pg_temp.steps(:'bob', 40000);
select tests.sign_in(:'ann');
set local role authenticated;
select is((public.hoops_live('00000000-0000-0000-0000-00000000b601') -> 'windows' ->> 'drive')::numeric, 0.18, 'never by more than half');
reset role;
select pg_temp.steps(:'bob', 3000);

-- How a release lands.
select is(array[public.hoops_quality(0, 0.26), public.hoops_quality(0.06, 0.26), public.hoops_quality(-0.1, 0.26),
                public.hoops_quality(0.2, 0.26), public.hoops_quality(-0.3, 0.26)],
  array['swish', 'swish', 'green', 'near', 'off'], 'Swish within a quarter of the window, green within half, near within it, else off');

-- So the first shot (a three, released late and off) misses and Ann's
-- side rebounds, give her seat an id whose rolls say so.
select id as old_seat from public.hoops_players where challenge_id = '00000000-0000-0000-0000-00000000b601' and user_id = :'ann' \gset
select md5('seat' || i)::uuid as ann_seat
from generate_series(1, 500) i
where public.rally_js_rand(public.rally_js_hash('00000000-0000-0000-0000-00000000b601:' || :'today' || ':' || md5('seat' || i)::uuid || ':live:1'))
        >= 0.03
  and public.rally_js_rand(public.rally_js_hash('00000000-0000-0000-0000-00000000b601:' || :'today' || ':' || md5('seat' || i)::uuid || ':live:1:reb'))
        < 0.6 * 8000.0 / 11000
order by i limit 1 \gset
update public.hoops_players set id = :'ann_seat' where id = :'old_seat';
update public.hoops_players set guarding = :'ann_seat' where guarding = :'old_seat';

-- 0223: the release decides. Even steps: a drive is 0.55, a three 0.35.
select is(array[public.hoops_release_chance(0.55, 'swish'), public.hoops_release_chance(0.55, 'green'), public.hoops_release_chance(0.35, 'green'),
                public.hoops_release_chance(0.55, 'near'), public.hoops_release_chance(0.35, 'near'), public.hoops_release_chance(0.95, 'off')],
  array[0.97, 0.90, 0.80, 0.25, 0.10, 0.03]::double precision[], 'Green goes in 80-95%, orange 10-25%, red almost never');

-- ── Taking shots ──
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.hoops_take_shot('00000000-0000-0000-0000-00000000b601', 'layup', 0)$$,
  'Pick drive, mid-range or three.', 'Only drive, mid-range or three');
select public.hoops_take_shot('00000000-0000-0000-0000-00000000b601', 'three', 0.45) as s1 \gset
select public.hoops_take_shot('00000000-0000-0000-0000-00000000b601', 'mid', 0) as s2 \gset
select public.hoops_take_shot('00000000-0000-0000-0000-00000000b601', 'mid', 0.2) as s3 \gset
select public.hoops_take_shot('00000000-0000-0000-0000-00000000b601', 'drive', -0.15) as s4 \gset
select throws_ok($$select public.hoops_take_shot('00000000-0000-0000-0000-00000000b601', 'mid', 0)$$,
  'No shots ready: your next one comes at 10,000 steps.', 'Four taken: no more until 10,000 steps');
reset role;

select is(:'s1'::jsonb ->> 'quality', 'off', 'A late release outside the window is off');
select is((:'s1'::jsonb ->> 'chance')::numeric, 0.03, 'and almost never goes in (0223: the release decides)');
select is(:'s1'::jsonb ->> 'made', 'false', 'It misses');
select isnt(:'s1'::jsonb -> 'putback', 'null'::jsonb, 'Ann''s side grabs the rebound: a putback');
select is((:'s1'::jsonb -> 'putback' ->> 'pts')::int, case when (:'s1'::jsonb -> 'putback' ->> 'made')::boolean then 2 else 0 end, 'worth two');
select ok(:'s1'::jsonb ->> 'message' like 'Rims out. Your side grabs it… %', 'and says so');
select is((select (l.rebound, l.putback_made is not null)::text from public.hoops_live_shots l where l.seat = :'ann_seat' and l.n = 1), '(home,t)',
  'The rebound and putback are kept');

select is(array[:'s2'::jsonb ->> 'quality', :'s3'::jsonb ->> 'quality', :'s4'::jsonb ->> 'quality'], array['swish', 'near', 'green'],
  'The middle is a swish, 0.2 late on a mid-range near, 0.15 early on a drive green');
select is(array[(:'s2'::jsonb ->> 'chance')::numeric, (:'s3'::jsonb ->> 'chance')::numeric, (:'s4'::jsonb ->> 'chance')::numeric],
  array[0.97,
        round(least(0.25, greatest(0.10, least(0.95, public.hoops_chance('mid', 8000, 3000, 'none', false, (:'s3'::jsonb ->> 'on_fire')::boolean)) - 0.30))::numeric, 2),
        round(least(0.95, greatest(0.80, least(0.95, public.hoops_chance('drive', 8000, 3000, 'none', false, (:'s4'::jsonb ->> 'on_fire')::boolean)) + 0.35))::numeric, 2)],
  'and decide it (0223): a swish 97%, the orange 10-25%, the green 80-95%');
select is(array(select l.made from public.hoops_live_shots l where l.seat = :'ann_seat' order by l.n),
  array(select public.rally_js_rand(public.rally_js_hash('00000000-0000-0000-0000-00000000b601:' || :'today' || ':' || :'ann_seat' || ':live:' || l.n)) < l.chance
        from public.hoops_live_shots l where l.seat = :'ann_seat' order by l.n),
  'Each result is the seeded roll against the chance');
select is(array[(:'s2'::jsonb ->> 'pts')::int, (:'s3'::jsonb ->> 'pts')::int, (:'s4'::jsonb ->> 'pts')::int],
  array[case when (:'s2'::jsonb ->> 'made')::boolean then 2 else 0 end, case when (:'s3'::jsonb ->> 'made')::boolean then 2 else 0 end,
        case when (:'s4'::jsonb ->> 'made')::boolean then 2 else 0 end], 'Two points a make inside the arc');
select is((:'s4'::jsonb ->> 'today_pts')::int,
  (select sum(l.pts + coalesce(l.putback_pts, 0))::int from public.hoops_live_shots l where l.seat = :'ann_seat'), 'today_pts adds them up');
select is((:'s4'::jsonb ->> 'ready')::int, 0, 'and none are left');

select tests.sign_in(:'ann');
set local role authenticated;
select is((select jsonb_build_object('taken', l -> 'taken', 'ready', l -> 'ready', 'n', jsonb_array_length(l -> 'shots'), 'first', l -> 'shots' -> 0 ->> 'kind')
           from public.hoops_live('00000000-0000-0000-0000-00000000b601') l),
  '{"taken": 4, "ready": 0, "n": 4, "first": "three"}'::jsonb, 'hoops_live lists today''s shots');
select is((select jsonb_build_object('hands_on', v -> 'hands_on', 'taken', v -> 'live' -> 'taken') from public.hoops_view('00000000-0000-0000-0000-00000000b601') v),
  '{"hands_on": true, "taken": 4}'::jsonb, 'hoops_view carries hands_on and live');
select is(public.hoops_view('00000000-0000-0000-0000-00000000b602') -> 'live', 'null'::jsonb, 'but no live in a hands-off game');

-- ── When you can't shoot ──
select is(public.hoops_live('00000000-0000-0000-0000-00000000b602') ->> 'reason', 'This game plays itself.', 'Not in a hands-off game');
select throws_ok($$select public.hoops_take_shot('00000000-0000-0000-0000-00000000b602', 'mid', 0)$$, 'This game plays itself.', 'so no shots there');
select is(public.hoops_live('00000000-0000-0000-0000-00000000b603') ->> 'reason', 'Not a game day.', 'Not on a day that isn''t one of the game''s');
reset role;
select tests.sign_in(:'cat');
set local role authenticated;
select throws_ok($$select public.hoops_live('00000000-0000-0000-0000-00000000b601')$$, 'not authorized', 'Someone outside the game can''t look');
reset role;

-- ── The day played: Ann ends on 12,000 (five shots: four live, one rolled)
-- and at four times Bob's steps; hands-off she'd be fouled on the first.
select pg_temp.steps(:'ann', 12000);
select public.hoops_play_day('00000000-0000-0000-0000-00000000b601', :'today'::date, 2);
select public.hoops_play_day('00000000-0000-0000-0000-00000000b602', :'today'::date, 2);

select is(array(select e.kind || ':' || e.made || ':' || e.pts || ':' || e.by_hand from public.hoops_events e
                where e.challenge_id = '00000000-0000-0000-0000-00000000b601' and e.shooter = :'ann_seat' and e.kind <> 'putback' order by e.seq),
  array(select l.kind || ':' || l.made || ':' || l.pts || ':true' from public.hoops_live_shots l where l.seat = :'ann_seat' order by l.n)
    || array(select e.kind || ':' || e.made || ':' || e.pts || ':false' from public.hoops_events e
             where e.challenge_id = '00000000-0000-0000-0000-00000000b601' and e.shooter = :'ann_seat' and not e.by_hand order by e.seq),
  'The live shots play first, as taken, by hand');
select is((select count(*)::int from public.hoops_events e where e.challenge_id = '00000000-0000-0000-0000-00000000b601' and e.shooter = :'ann_seat'
           and e.kind <> 'putback' and not e.by_hand), 1, 'then the one shot left is rolled');
select is((select array_agg(e.kind order by e.seq) from public.hoops_events e where e.challenge_id = '00000000-0000-0000-0000-00000000b601'
           and e.shooter = :'ann_seat' and e.by_hand and e.seq < (select min(x.seq) from public.hoops_events x
             where x.challenge_id = e.challenge_id and x.shooter = e.shooter and x.kind = 'mid')),
  array['three', 'putback'], 'The putback plays right after its miss');
select is((select count(*)::int from public.hoops_events e where e.challenge_id = '00000000-0000-0000-0000-00000000b601' and e.shooter = :'ann_seat' and e.kind = 'ft'),
  0, 'No foul when the first shot was live');
select is((select sum(e.pts)::int from public.hoops_events e where e.challenge_id = '00000000-0000-0000-0000-00000000b601' and e.shooter = :'ann_seat' and e.by_hand),
  (select sum(l.pts + coalesce(l.putback_pts, 0))::int from public.hoops_live_shots l where l.seat = :'ann_seat'), 'The live points count');
select is((select d.home from public.hoops_days d where d.challenge_id = '00000000-0000-0000-0000-00000000b601' and d.day = :'today'::date),
  (select sum(e.pts)::int from public.hoops_events e where e.challenge_id = '00000000-0000-0000-0000-00000000b601' and e.team = 'home'), 'in the day''s score');

select is((select count(*)::int from public.hoops_events e join public.hoops_players p on p.id = e.shooter
           where e.challenge_id = '00000000-0000-0000-0000-00000000b602' and p.user_id = :'ann' and e.kind = 'ft'), 2,
  'Hands-off, the same day: fouled on the first, as before');
select is((select count(*)::int from public.hoops_events e join public.hoops_players p on p.id = e.shooter
           where e.challenge_id = '00000000-0000-0000-0000-00000000b602' and p.user_id = :'ann' and e.kind in ('drive', 'mid', 'three')), 4,
  'then four shots rolled');
select is((select count(*)::int from public.hoops_events e where e.challenge_id = '00000000-0000-0000-0000-00000000b602' and e.by_hand), 0, 'none by hand');
select is((select count(*)::int from jsonb_array_elements(public.hoops_events_json('00000000-0000-0000-0000-00000000b601', null, :'today'::date)) x
           where (x ->> 'by_hand')::boolean),
  (select (count(*) + count(l.putback_made))::int from public.hoops_live_shots l where l.seat = :'ann_seat'), 'hoops_events_json marks the plays by hand');

select tests.sign_in(:'ann');
set local role authenticated;
select is(public.hoops_live('00000000-0000-0000-0000-00000000b601') ->> 'reason', 'Today''s already been played.', 'Not once the day is played');
select throws_ok($$select public.admin_hoops_overview()$$, 'not authorized', 'Admin only');
reset role;
select tests.sign_in(:'ada');
set local role authenticated;
select ok(((o -> 'live' ->> 'shots_7d')::int >= 4 and (o -> 'live' ->> 'people_7d')::int >= 1 and (o -> 'live' ->> 'games_hands_on')::int >= 2
             and (o -> 'live') ? 'make_rate_7d' and (o -> 'live') ? 'auto_make_rate_7d' and (o -> 'live') ? 'swish_7d'),
          'Admin sees the shots taken by hand')
from public.admin_hoops_overview() o;
reset role;

select * from finish();
