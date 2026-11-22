-- 0231: Baseball for real. The tap's cost, jump bonuses, the words for a
-- location; pitches that cross somewhere (and the curveball); a swing
-- judged by where you tapped as well as when (and the old call as
-- before); six at-bats a day; the mound (the next batter in their order,
-- the ring, a painted corner, the at-bat finished and waiting, the shared
-- cap and the waiting cap); the inning using a pitched at-bat after the
-- batter's own; steal jumps (once a day, the pickoff, the steal decided
-- by the jump); the Derby's tap (and, 0245, its meter); and Admin.
select plan(46);

select tests.new_user_with_id('00000000-0000-0000-0000-0000000aa001', 'Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select tests.new_user('Ada', true) as ada \gset
update public.profiles set time_zone = 'America/New_York' where id in (:'ann', :'bob', :'cat');
select public.soccer_today(:'ann') as today \gset
select :'today'::date - 1 as d1 \gset

-- ── The numbers ──
select is(array[public.baseball_tap_ms(0.1), public.baseball_tap_ms(0.5), public.baseball_tap_ms(1.2)], array[0, 30, 100]::double precision[],
  'The tap: the first 0.2 is free, then 100 ms a half-width');
select is(array[public.baseball_jump_bonus(150, 'perfect'), public.baseball_jump_bonus(300, 'early'), public.baseball_jump_bonus(600, 'none')],
  array[0.25, -0.05, -0.23]::double precision[], 'A jump: great +0.20, good +0.05, late -0.15, and the slide');
select is(public.baseball_jump_bonus(-40, 'perfect'), null, 'Going before the leg kick is a pickoff');
select is(array[public.baseball_jump_grade(-1), public.baseball_jump_grade(200), public.baseball_jump_grade(400), public.baseball_jump_grade(401)],
  array['picked', 'great', 'good', 'late'], 'and its grade');
select is(array[public.baseball_where(0, 0), public.baseball_where(0, 1.3), public.baseball_where(-0.9, -0.6), public.baseball_where(1.2, 0)],
  array['right down the middle', 'high', 'low and away, on the black', 'inside'], 'Where a pitch crosses, in words');

-- R1: hands-on, Ann (a) against Bob and Cat (b), on its second day.
-- R2, R3, R4: hands-on, for the inning.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day)
select g, n, 'baseball', :'ann', 3,
  (:'today'::date - 1)::timestamp at time zone 'America/New_York', (:'today'::date + 2)::timestamp at time zone 'America/New_York', :'today'::date - 1
from (values ('00000000-0000-0000-0000-00000000bb01'::uuid, 'Real'), ('00000000-0000-0000-0000-00000000bb02'::uuid, 'Pitched'),
             ('00000000-0000-0000-0000-00000000bb03'::uuid, 'Picked off'), ('00000000-0000-0000-0000-00000000bb04'::uuid, 'Jump')) v(g, n);
insert into public.challenge_participants (challenge_id, user_id)
select g, u from unnest(array['00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-00000000bb02', '00000000-0000-0000-0000-00000000bb03',
  '00000000-0000-0000-0000-00000000bb04']::uuid[]) g, unnest(array[:'ann'::uuid]) u;
select tests.sign_in(:'ann');
set local role authenticated;
select public.baseball_setup('00000000-0000-0000-0000-00000000bb01',
  ('[{"id":"' || :'ann' || '","team":"a"},{"id":"' || :'bob' || '","team":"b"},{"id":"' || :'cat' || '","team":"b"}]')::jsonb, true);
select public.baseball_setup(g, ('[{"id":"' || :'ann' || '","team":"a"},{"id":"' || :'bob' || '","team":"b"}]')::jsonb, true)
  from unnest(array['00000000-0000-0000-0000-00000000bb02', '00000000-0000-0000-0000-00000000bb03', '00000000-0000-0000-0000-00000000bb04']::uuid[]) g;
reset role;
insert into public.challenge_participants (challenge_id, user_id)
select g, u from unnest(array['00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-00000000bb02', '00000000-0000-0000-0000-00000000bb03',
  '00000000-0000-0000-0000-00000000bb04']::uuid[]) g, unnest(array[:'bob'::uuid]) u;
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-00000000bb01', :'cat');
insert into public.progress_snapshots (challenge_id, user_id, day, steps)
select '00000000-0000-0000-0000-00000000bb01', u, :'today'::date, s from (values (:'ann'::uuid, 6400), (:'bob'::uuid, 6400), (:'cat'::uuid, 3000)) v(u, s);

create function pg_temp.fix_pitch(p_px double precision, p_py double precision) returns void language sql as $$
  update public.baseball_live_pitches lp set in_zone = abs(p_px) <= 1 and abs(p_py) <= 1, pressure = 0, px = p_px, py = p_py
  from public.baseball_live_abs a
  where a.id = lp.ab_id and a.challenge_id = '00000000-0000-0000-0000-00000000bb01' and a.role = 'bat' and a.status = 'open' and lp.call is null;
$$;

-- ── Batting: where it crosses ──
select tests.sign_in(:'ann');
set local role authenticated;
select public.baseball_pitch('00000000-0000-0000-0000-00000000bb01') as p1 \gset
select is((:'p1'::jsonb) ?& array['px', 'py'], true, 'A pitch says where it crosses');
select is(((:'p1'::jsonb) ->> 'in_zone')::boolean, abs(((:'p1'::jsonb) ->> 'px')::numeric) <= 1 and abs(((:'p1'::jsonb) ->> 'py')::numeric) <= 1,
  'in the zone means inside it');
reset role;
select is((:'p1'::jsonb) ->> 'kind',
  case when public.baseball_rand('00000000-0000-0000-0000-00000000bb01:' || :'ann' || ':live:1:1:change') < 0.30 then 'changeup'
       when public.baseball_rand('00000000-0000-0000-0000-00000000bb01:' || :'ann' || ':live:1:1:curve') < 0.25 then 'curveball'
       else 'fastball' end, 'Fastball, changeup or the seeded curveball');
select tests.sign_in(:'ann');
set local role authenticated;
select is(public.baseball_live('00000000-0000-0000-0000-00000000bb01') -> 'open' -> 'pending' -> 'px', (:'p1'::jsonb) -> 'px',
  'and baseball_live shows the same spot');
reset role;
select pg_temp.fix_pitch(0.3, 0.2);
select tests.sign_in(:'ann');
set local role authenticated;
select public.baseball_swing('00000000-0000-0000-0000-00000000bb01', 0, 0.3, 0.2) as s1 \gset
select is((:'s1'::jsonb) ->> 'call' in ('in_play', 'foul'), true, 'Right on it, right on time: contact');
select is(((:'s1'::jsonb) ->> 'miss')::numeric, 0::numeric, 'and the miss is 0');
reset role;
select is((select miss from public.baseball_live_pitches lp join public.baseball_live_abs a on a.id = lp.ab_id
  where a.challenge_id = '00000000-0000-0000-0000-00000000bb01' and lp.pitch_no = 1 and a.n = 1), 0::double precision, 'kept on the pitch');

-- A second at-bat: on time, but a long way from the ball.
select tests.sign_in(:'ann');
set local role authenticated;
select public.baseball_pitch('00000000-0000-0000-0000-00000000bb01');
reset role;
update public.baseball_live_abs set balls = 0, strikes = 0 where challenge_id = '00000000-0000-0000-0000-00000000bb01' and status = 'open';
select pg_temp.fix_pitch(0, 0);
select tests.sign_in(:'ann');
set local role authenticated;
select is((select jsonb_build_object('call', s -> 'call', 'message', s -> 'message', 'miss', s -> 'miss')
  from public.baseball_swing('00000000-0000-0000-0000-00000000bb01', 0, 1.5, 0) s),
  jsonb_build_object('call', 'whiff', 'message', 'Swung over it: tap where the ball crosses.', 'miss', 1.5),
  'On time but 1.5 off: 130 ms, past the foul band, a whiff');
select public.baseball_pitch('00000000-0000-0000-0000-00000000bb01');
reset role;
select pg_temp.fix_pitch(0, 0);
select tests.sign_in(:'ann');
set local role authenticated;
select is((public.baseball_swing('00000000-0000-0000-0000-00000000bb01', 0) ->> 'call') <> 'whiff', true,
  'The old call, timing only, is judged as right on the ball');

-- ── Six a day ──
reset role;
update public.progress_snapshots set steps = 18500 where challenge_id = '00000000-0000-0000-0000-00000000bb01' and user_id = :'ann';
select tests.sign_in(:'ann');
set local role authenticated;
select is((select jsonb_build_object('earned', l -> 'earned', 'next_at', l -> 'next_at', 'cap', l -> 'cap')
  from public.baseball_live('00000000-0000-0000-0000-00000000bb01') l),
  jsonb_build_object('earned', 6, 'next_at', null, 'cap', 6), '18,500 steps: six at-bats, the most a day');

-- ── The mound ──
reset role;
-- Close Ann's open at-bat so the count is clean.
update public.baseball_live_abs set status = 'done', result = 'strikeout' where challenge_id = '00000000-0000-0000-0000-00000000bb01' and status = 'open';
select tests.sign_in(:'ann');
set local role authenticated;
select public.baseball_mound('00000000-0000-0000-0000-00000000bb01') as m0 \gset
select is((select jsonb_build_object('can_pitch', m -> 'can_pitch', 'batter', m -> 'batter' -> 'name', 'open', m -> 'open', 'cap', m -> 'cap')
  from (select :'m0'::jsonb m) x),
  jsonb_build_object('can_pitch', true, 'batter', 'Bob', 'open', null, 'cap', 6), 'On the mound: Bob leads off their order');
select is((:'m0'::jsonb) ? '_batter', false, 'and nothing internal shows');
select throws_ok($$select public.baseball_throw('00000000-0000-0000-0000-00000000bb01', 'knuckler', 0, 0, 0)$$,
  'Pick a pitch: a fastball, a curveball or a changeup.', 'Three pitches to pick from');
select public.baseball_throw('00000000-0000-0000-0000-00000000bb01', 'fastball', 0.9, 0.9, 0) as t1 \gset
select is((select jsonb_build_object('px', t -> 'px', 'py', t -> 'py', 'in_zone', t -> 'in_zone', 'grade', t -> 'grade', 'batter', t -> 'batter')
  from (select :'t1'::jsonb t) x),
  jsonb_build_object('px', 0.9, 'py', 0.9, 'in_zone', true, 'grade', 'Painted it', 'batter', 'Bob'), 'Ring on the circle: right on your corner');
select is(left((:'t1'::jsonb) ->> 'message', 11), 'Painted it.', 'and the message says so');
select is(public.baseball_throw('00000000-0000-0000-0000-00000000bb01', 'changeup', 0.9, -0.9, 1) ->> 'grade'
  in ('Missed your spot', 'Missed your spot, over the middle'), true, 'Nowhere near the circle: it misses the spot');
select is((public.baseball_mound('00000000-0000-0000-0000-00000000bb01') -> 'open' ->> 'last_kind'), 'changeup', 'The open at-bat knows the last pitch');
create function pg_temp.finish_ab() returns int language plpgsql as $$
declare r jsonb; i int := 0;
begin
  loop
    i := i + 1;
    r := public.baseball_throw('00000000-0000-0000-0000-00000000bb01', case when i % 2 = 0 then 'fastball' else 'curveball' end, 0.5, -0.5, 0.1);
    exit when (r ->> 'done')::boolean or i >= 20;
  end loop;
  return i;
end $$;
select ok(pg_temp.finish_ab() < 20, 'The at-bat ends: a walk, a strikeout or a ball in play');
select is((select jsonb_build_object('open', m -> 'open', 'batter', m -> 'batter' -> 'name', 'abs', jsonb_array_length(m -> 'abs'), 'waiting', m -> 'waiting')
  from public.baseball_mound('00000000-0000-0000-0000-00000000bb01') m),
  jsonb_build_object('open', null, 'batter', 'Cat', 'abs', 1, 'waiting', 1), 'It waits for Bob, and Cat is up next');
reset role;
select is((select role || ':' || (batter_id = :'bob')::text || ':' || status from public.baseball_live_abs
  where challenge_id = '00000000-0000-0000-0000-00000000bb01' and user_id = :'ann' and role = 'pitch'), 'pitch:true:done',
  'Kept as a pitched at-bat against Bob');
select is((select count(*)::int from public.baseball_live_pitches lp join public.baseball_live_abs a on a.id = lp.ab_id
  where a.role = 'pitch' and a.challenge_id = '00000000-0000-0000-0000-00000000bb01' and lp.ring is not null and lp.aim_x is not null),
  (select pitches from public.baseball_live_abs where challenge_id = '00000000-0000-0000-0000-00000000bb01' and role = 'pitch'),
  'every pitch with its aim and ring');
select tests.sign_in(:'ann');
set local role authenticated;
select is((public.baseball_live('00000000-0000-0000-0000-00000000bb01') ->> 'taken')::int,
  (select count(*)::int + 1 from public.baseball_live_abs where challenge_id = '00000000-0000-0000-0000-00000000bb01' and role = 'bat' and day = :'today'),
  'At bat and on the mound share today''s six');
reset role;
insert into public.baseball_live_abs (challenge_id, user_id, team, n, day, status, result, role, batter_id)
select '00000000-0000-0000-0000-00000000bb01', :'ann', 'a', 100 + i, :'d1', 'done', 'strikeout', 'pitch', :'cat' from generate_series(1, 2) i;
select tests.sign_in(:'ann');
set local role authenticated;
select is(public.baseball_mound('00000000-0000-0000-0000-00000000bb01') ->> 'reason', '3 pitched at-bats waiting for their batters.',
  'Three pitched and waiting: no more for now');
select throws_ok($$select public.baseball_throw('00000000-0000-0000-0000-00000000bb01', 'fastball', 0, 0, 0)$$,
  '3 pitched at-bats waiting for their batters.', 'and no pitch');
select is((public.baseball_live('00000000-0000-0000-0000-00000000bb01') ->> 'can_bat')::boolean, true, 'but you can still bat');
reset role;

-- ── The inning uses a pitched at-bat after the batter's own ──
-- R2: Bob bats alone. His own walk first; next time up, the strikeout
-- Ann pitched to him.
insert into public.baseball_live_abs (challenge_id, user_id, team, n, day, status, result, role, batter_id)
values ('00000000-0000-0000-0000-00000000bb02', :'bob', 'b', 1, :'d1', 'done', 'walk', 'bat', null),
       ('00000000-0000-0000-0000-00000000bb02', :'ann', 'a', 1, :'d1', 'done', 'strikeout', 'pitch', :'bob');
select public.baseball_half('00000000-0000-0000-0000-00000000bb02', :'d1', :'d1', 1, 'top', 'b', 0, null);
select is((select array_agg(kind || ':' || by_hand order by seq) from (
    select * from public.baseball_plays where challenge_id = '00000000-0000-0000-0000-00000000bb02' and batter_id = :'bob' order by seq limit 2) x),
  array['walk:true', 'strikeout:true'], 'Bob''s own walk, then the strikeout Ann pitched to him');
select is((select count(*)::int from public.baseball_live_abs where challenge_id = '00000000-0000-0000-0000-00000000bb02' and used_day = :'d1'), 2,
  'both used');

-- ── Steal jumps ──
select tests.sign_in(:'ann');
set local role authenticated;
select is((select jsonb_build_object('grade', j -> 'grade', 'slide', j -> 'slide', 'bonus', j -> 'bonus')
  from public.baseball_steal_jump('00000000-0000-0000-0000-00000000bb01', 150, 'perfect') j),
  jsonb_build_object('grade', 'great', 'slide', 'perfect', 'bonus', 0.25), 'A great jump and a perfect slide');
select throws_ok($$select public.baseball_steal_jump('00000000-0000-0000-0000-00000000bb01', 100, 'perfect')$$,
  'Your jump is set for today. It''s used if you reach base tonight.', 'Once a day');
select is(public.baseball_live('00000000-0000-0000-0000-00000000bb01') -> 'steal_jump' ->> 'grade', 'great', 'baseball_live shows it');
reset role;
select tests.sign_in(:'cat');
set local role authenticated;
select is((select jsonb_build_object('grade', j -> 'grade', 'slide', j -> 'slide') from public.baseball_steal_jump('00000000-0000-0000-0000-00000000bb01', -30, 'perfect') j),
  jsonb_build_object('grade', 'picked', 'slide', 'none'), 'Before the leg kick: a pickoff');
reset role;
update public.baseball_games set status = 'final' where challenge_id = '00000000-0000-0000-0000-00000000bb02';
select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok($$select public.baseball_steal_jump('00000000-0000-0000-0000-00000000bb02', 100, 'perfect')$$,
  'This game is over.', 'Not once the game is over');
reset role;

-- R3: Ann singles (by hand), then she's the runner with second open, and
-- yesterday she went before the leg kick: caught stealing.
insert into public.baseball_live_abs (challenge_id, user_id, team, n, day, status, result, contact, aim, fielder_pos, len, caught, late)
values ('00000000-0000-0000-0000-00000000bb03', :'ann', 'a', 1, :'d1', 'done', 'single', 'solid', 'left', 'lf', 1, false, false);
insert into public.baseball_steal_jumps (challenge_id, user_id, day, jump_ms, slide) values ('00000000-0000-0000-0000-00000000bb03', :'ann', :'d1', -50, 'none');
select public.baseball_half('00000000-0000-0000-0000-00000000bb03', :'d1', :'d1', 1, 'top', 'a', 0, null);
select is((select kind || ':' || steal_jump from public.baseball_plays where challenge_id = '00000000-0000-0000-0000-00000000bb03' and runner_id = :'ann'
  and kind in ('stolen_base', 'caught_stealing') order by seq limit 1), 'caught_stealing:-50', 'A pickoff: caught stealing');
select is((select used_inning || used_half || ':' || safe from public.baseball_steal_jumps where challenge_id = '00000000-0000-0000-0000-00000000bb03'),
  '1top:false', 'and the jump is used');
-- R4: the same with a great jump: the steal goes either way, by the jump.
insert into public.baseball_live_abs (challenge_id, user_id, team, n, day, status, result, contact, aim, fielder_pos, len, caught, late)
values ('00000000-0000-0000-0000-00000000bb04', :'ann', 'a', 1, :'d1', 'done', 'single', 'solid', 'left', 'lf', 1, false, false);
insert into public.baseball_steal_jumps (challenge_id, user_id, day, jump_ms, slide) values ('00000000-0000-0000-0000-00000000bb04', :'ann', :'d1', 150, 'perfect');
select public.baseball_half('00000000-0000-0000-0000-00000000bb04', :'d1', :'d1', 1, 'top', 'a', 0, null);
select is((select (case when p.kind = 'stolen_base' then 'true' else 'false' end) = j.safe::text and p.steal_jump = 150
  from public.baseball_plays p, public.baseball_steal_jumps j
  where p.challenge_id = '00000000-0000-0000-0000-00000000bb04' and j.challenge_id = p.challenge_id and p.runner_id = :'ann'
    and p.kind in ('stolen_base', 'caught_stealing') order by p.seq limit 1), true, 'A great jump: the steal is tried, and the play keeps the jump');

-- ── The Derby ──
select tests.sign_in(:'ada');
set local role authenticated;
select public.publish_global_challenge('Hound Home Run Derby', 'derby', 7, now() - interval '1 hour', now() + interval '3 days') as derby \gset
select public.derby_setup_global(:'derby');
reset role;
select tests.sign_in(:'cat');
set local role authenticated;
select public.join_global_challenge(:'derby');
reset role;
insert into public.progress_snapshots (challenge_id, user_id, day, steps) values (:'derby', :'cat', :'today', 4000);
insert into public.derby_days (challenge_id, user_id, day, golden1, golden2) values (:'derby', :'cat', :'today', 10, null);
select tests.sign_in(:'cat');
set local role authenticated;
select public.derby_pitch(:'derby') as dp \gset
select is(abs(((:'dp'::jsonb) ->> 'px')::numeric) <= 0.45 and abs(((:'dp'::jsonb) ->> 'py')::numeric) <= 0.45, true,
  'A Derby meatball crosses near the middle');
select is(public.derby_swing(:'derby', 0, ((:'dp'::jsonb) ->> 'px')::double precision, ((:'dp'::jsonb) ->> 'py')::double precision) ->> 'message',
  'Gone! 435 ft.', 'Dead on, right on the ball: 435 ft');
select public.derby_pitch(:'derby') as dp2 \gset
select is((select jsonb_build_object('result', s -> 'result', 'message', s -> 'message')
  from public.derby_swing(:'derby', 0, ((:'dp2'::jsonb) ->> 'px')::double precision + 1.5, ((:'dp2'::jsonb) ->> 'py')::double precision) s),
  jsonb_build_object('result', 'fly_out', 'message', 'Off the end of the bat, caught at the wall: tap right on the ball.'),
  'On time but 1.5 off the ball: 78 ms, caught at the wall');
-- 0245: the meter swings with the timing alone.
select public.derby_pitch(:'derby') as dp3 \gset
select is(public.derby_swing(:'derby', 0) ->> 'result', 'hr', 'The meter: dead on, with no tap, is gone');
reset role;

-- ── Admin ──
select tests.sign_in(:'ada');
set local role authenticated;
select is((select jsonb_build_object('pitched', l -> 'pitched_7d', 'pitchers', l -> 'pitchers_7d', 'jumps', l -> 'jumps_7d', 'great', l -> 'great_jumps_7d',
    'tapped', l -> 'tapped_7d', 'derby', l -> 'derby_tapped_7d', 'painted', l -> 'painted_7d')
  from (select o -> 'live' l from public.admin_baseball_overview() o) x),
  jsonb_build_object('pitched', 4, 'pitchers', 1, 'jumps', 4, 'great', 2, 'tapped', 2, 'derby', 2, 'painted', 1),
  'Admin: pitched at-bats, pitchers, jumps, the tap and painted corners');
select is((select jsonb_build_object('metered', l -> 'metered_7d', 'derby', l -> 'derby_metered_7d', 'meter_people', l -> 'meter_people_7d', 'tap_people', l -> 'tap_people_7d')
  from (select o -> 'live' l from public.admin_baseball_overview() o) x),
  jsonb_build_object('metered', 1, 'derby', 1, 'meter_people', 2, 'tap_people', 2),
  'Admin (0245): swings with the meter and by tapping, and who');
reset role;

select * from finish();
