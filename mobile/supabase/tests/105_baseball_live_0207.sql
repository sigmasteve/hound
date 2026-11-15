-- 0207: Baseball, take your own at-bats. At-bats earned from steps so
-- far, the pitcher's pressure on the timing bands and the fastball, a
-- take in or out of the zone, the count to a walk and a strikeout, the
-- two-strike foul and the tenth-pitch tip, contact in play, the seeded
-- pitches, when you can't bat, the inning using waiting at-bats first
-- (and one the order didn't reach waiting for the next), hands-off games
-- as before, the plays' by_hand, and Admin.
select plan(55);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select tests.new_user('Dan') as dan \gset
select tests.new_user('Eve') as eve \gset
select tests.new_user('Ada', true) as ada \gset
update public.profiles set time_zone = 'America/New_York' where id in (:'ann', :'bob', :'cat', :'dan', :'eve');
select public.soccer_today(:'ann') as today \gset

-- A: hands-on, Ann (a) against Bob (b), on its second day. B: the same,
-- hands-off. C: hands-on and over. D: hands-on, for the waiting cap.
-- F: hands-on, Cat, Dan, Eve and Ann (a) against Bob, for the order.
-- G: hands-off, Ann against Bob, to show nothing changes.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day)
select g, n, 'baseball', :'ann', 3,
  (:'today'::date - 1)::timestamp at time zone 'America/New_York', (:'today'::date + 2)::timestamp at time zone 'America/New_York', :'today'::date - 1
from (values ('00000000-0000-0000-0000-00000000ba01'::uuid, 'Hands on'), ('00000000-0000-0000-0000-00000000ba02'::uuid, 'Hands off'),
             ('00000000-0000-0000-0000-00000000ba03'::uuid, 'Over'), ('00000000-0000-0000-0000-00000000ba04'::uuid, 'Waiting'),
             ('00000000-0000-0000-0000-00000000ba06'::uuid, 'The order'), ('00000000-0000-0000-0000-00000000ba07'::uuid, 'Rolled')) v(g, n);
insert into public.challenge_participants (challenge_id, user_id)
select g, :'ann' from unnest(array['00000000-0000-0000-0000-00000000ba01', '00000000-0000-0000-0000-00000000ba02', '00000000-0000-0000-0000-00000000ba03',
  '00000000-0000-0000-0000-00000000ba04', '00000000-0000-0000-0000-00000000ba06', '00000000-0000-0000-0000-00000000ba07']::uuid[]) g;

select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok($$select public.baseball_setup('00000000-0000-0000-0000-00000000ba01',
  '[{"id":"$$ || :'ann' || $$","team":"a"},{"id":"$$ || :'bob' || $$","team":"b"},{"id":"$$ || :'cat' || $$","team":"b"}]'::jsonb, p_hands_on => true)$$,
  'baseball_setup takes p_hands_on');
select lives_ok($$select public.baseball_setup('00000000-0000-0000-0000-00000000ba02',
  '[{"id":"$$ || :'ann' || $$","team":"a"},{"id":"$$ || :'bob' || $$","team":"b"}]'::jsonb)$$,
  'and the old two-argument call still works');
select public.baseball_setup(g, ('[{"id":"' || :'ann' || '","team":"a"},{"id":"' || :'bob' || '","team":"b"}]')::jsonb, true)
  from unnest(array['00000000-0000-0000-0000-00000000ba03', '00000000-0000-0000-0000-00000000ba04']::uuid[]) g;
select public.baseball_setup('00000000-0000-0000-0000-00000000ba06',
  ('[{"id":"' || :'cat' || '","team":"a"},{"id":"' || :'dan' || '","team":"a"},{"id":"' || :'eve' || '","team":"a"},'
   || '{"id":"' || :'ann' || '","team":"a"},{"id":"' || :'bob' || '","team":"b"}]')::jsonb, true);
select public.baseball_setup('00000000-0000-0000-0000-00000000ba07',
  ('[{"id":"' || :'cat' || '","team":"a"},{"id":"' || :'dan' || '","team":"a"},{"id":"' || :'eve' || '","team":"a"},'
   || '{"id":"' || :'ann' || '","team":"a"},{"id":"' || :'bob' || '","team":"b"}]')::jsonb);
reset role;
insert into public.challenge_participants (challenge_id, user_id)
select g, :'bob' from unnest(array['00000000-0000-0000-0000-00000000ba01', '00000000-0000-0000-0000-00000000ba02', '00000000-0000-0000-0000-00000000ba03',
  '00000000-0000-0000-0000-00000000ba04', '00000000-0000-0000-0000-00000000ba06', '00000000-0000-0000-0000-00000000ba07']::uuid[]) g;
insert into public.challenge_participants (challenge_id, user_id)
select g, u from unnest(array['00000000-0000-0000-0000-00000000ba06', '00000000-0000-0000-0000-00000000ba07']::uuid[]) g,
  unnest(array[:'cat', :'dan', :'eve']::uuid[]) u;
update public.baseball_games set status = 'final' where challenge_id = '00000000-0000-0000-0000-00000000ba03';

select is((select array_agg(hands_on order by challenge_id) from public.baseball_games
  where challenge_id in ('00000000-0000-0000-0000-00000000ba01', '00000000-0000-0000-0000-00000000ba02', '00000000-0000-0000-0000-00000000ba06', '00000000-0000-0000-0000-00000000ba07')),
  array[true, false, true, false], 'hands_on is set from Create, off by default');

-- Today so far: Ann 2,000 steps, Bob 2,000.
insert into public.progress_snapshots (challenge_id, user_id, day, steps)
select g, u, :'today'::date, 2000
from unnest(array['00000000-0000-0000-0000-00000000ba01', '00000000-0000-0000-0000-00000000ba02', '00000000-0000-0000-0000-00000000ba03',
  '00000000-0000-0000-0000-00000000ba04']::uuid[]) g
cross join unnest(array[:'ann', :'bob']::uuid[]) u;
create function pg_temp.steps(p_user uuid, p_steps int) returns void language sql as $$
  update public.progress_snapshots set steps = p_steps where user_id = p_user and day = public.soccer_today(p_user);
$$;

-- ── The numbers ──
select is(public.baseball_live_band('barrel', 0, true), 27::double precision, 'Level: the barrel band is 27 ms either side');
select is(public.baseball_live_band('foul', 0, false), 63::double precision, 'out of the zone, every band is half');
select is(public.baseball_live_band('barrel', 0.5, true), 13.5::double precision, 'and the most pressure halves them too');
select is(public.baseball_live_pressure(9000, 6000), (1.0 / 3)::double precision, 'Pressure: the pitcher''s lead over the greater');
select is(public.baseball_live_pressure(3000, 9000), 0::double precision, 'none when you out-walk them');
select is(public.baseball_live_pressure(20000, 1000), 0.5::double precision, 'at most a half');
select is(array[public.baseball_live_contact(10, 0, true), public.baseball_live_contact(-40, 0, true), public.baseball_live_contact(70, 0, true),
                public.baseball_live_contact(-120, 0, true), public.baseball_live_contact(200, 0, true), public.baseball_live_contact(30, 0, false)],
  array['barrel', 'solid', 'weak', 'foul', 'whiff', 'weak'], 'Timing makes barrel, solid, weak, foul or a whiff, tighter out of the zone');
select is(array[public.baseball_live_catch_mod('barrel'), public.baseball_live_catch_mod('solid'), public.baseball_live_catch_mod('weak')],
  array[0, -0.05, 0.10]::double precision[], 'Contact moves the catch: solid finds holes, weak is caught more');

-- ── At-bats from steps ──
select tests.sign_in(:'ann');
set local role authenticated;
select is(public.baseball_live('00000000-0000-0000-0000-00000000ba01') ->> 'reason', 'No at-bats ready: your next one comes at 3,000 steps.',
  'At 2,000 steps, no at-bats yet');
select is(public.baseball_live('00000000-0000-0000-0000-00000000ba01') ? '_player', false, 'and nothing internal shows');
select throws_ok($$select public.baseball_pitch('00000000-0000-0000-0000-00000000ba01')$$,
  'No at-bats ready: your next one comes at 3,000 steps.', 'Pitching needs an at-bat ready');
select throws_ok($$select public.baseball_swing('00000000-0000-0000-0000-00000000ba01', 0)$$, 'Pitch first.', 'and swinging needs a pitch');
reset role;
select pg_temp.steps(:'ann', 6400);
select pg_temp.steps(:'bob', 9600);
select tests.sign_in(:'ann');
set local role authenticated;
select is((select jsonb_build_object('can_bat', l -> 'can_bat', 'earned', l -> 'earned', 'ready', l -> 'ready', 'next_at', l -> 'next_at',
    'steps', l -> 'steps', 'pitcher', l -> 'pitcher', 'pressure', l -> 'pressure', 'bands', l -> 'bands')
  from public.baseball_live('00000000-0000-0000-0000-00000000ba01') l),
  jsonb_build_object('can_bat', true, 'earned', 2, 'ready', 2, 'next_at', 9000, 'steps', 6400,
    'pitcher', jsonb_build_object('name', 'Bob', 'steps', 9600), 'pressure', 0.333,
    'bands', jsonb_build_object('barrel', 18, 'solid', 34, 'weak', 54, 'foul', 84)),
  'At 6,400 steps, two at-bats; Bob''s lead tightens the bands');

-- ── A pitch ──
select public.baseball_pitch('00000000-0000-0000-0000-00000000ba01') as p1 \gset
select is(public.baseball_pitch('00000000-0000-0000-0000-00000000ba01'), :'p1'::jsonb, 'Asking again before the swing: the same pitch');
select is((:'p1'::jsonb) - 'bands' - 'mph',
  jsonb_build_object('ab', 1, 'pitch_no', 1, 'balls', 0, 'strikes', 0,
    'kind', case when public.baseball_rand('00000000-0000-0000-0000-00000000ba01:' || :'ann' || ':live:1:1:change') < 0.30 then 'changeup' else 'fastball' end,
    'in_zone', public.baseball_rand('00000000-0000-0000-0000-00000000ba01:' || :'ann' || ':live:1:1:zone') < 0.50,
    'ms', case when public.baseball_rand('00000000-0000-0000-0000-00000000ba01:' || :'ann' || ':live:1:1:change') < 0.30 then 1000
          else round(700 * (1 - 0.3 * (1.0 / 3)))::int end),
  'The pitch is seeded: kind, zone, and a quicker fastball against a pitcher who out-walks you');
select is(((:'p1'::jsonb) ->> 'mph')::int, case when (:'p1'::jsonb) ->> 'kind' = 'changeup' then 80 else 95 end, 'mph: 88 + 20 x pressure, a changeup 80');
select is(public.baseball_live('00000000-0000-0000-0000-00000000ba01') -> 'open',
  jsonb_build_object('ab', 1, 'pitch_no', 1, 'balls', 0, 'strikes', 0,
    'pending', jsonb_build_object('kind', (:'p1'::jsonb) ->> 'kind', 'mph', ((:'p1'::jsonb) ->> 'mph')::int,
      'in_zone', ((:'p1'::jsonb) ->> 'in_zone')::boolean, 'ms', ((:'p1'::jsonb) ->> 'ms')::int)),
  'The open at-bat and its pitch show in baseball_live');

-- Took it: a ball out of the zone, a strike in it.
select public.baseball_swing('00000000-0000-0000-0000-00000000ba01', null) as s1 \gset
select is((:'s1'::jsonb) - 'ready' - 'waiting',
  case when ((:'p1'::jsonb) ->> 'in_zone')::boolean
    then jsonb_build_object('call', 'strike', 'contact', null, 'balls', 0, 'strikes', 1, 'done', false, 'result', null, 'message', 'It caught the zone.')
    else jsonb_build_object('call', 'ball', 'contact', null, 'balls', 1, 'strikes', 0, 'done', false, 'result', null, 'message', 'Good eye.') end,
  'A take: in the zone a called strike, out of it a ball');
select throws_ok($$select public.baseball_swing('00000000-0000-0000-0000-00000000ba01', 0)$$, 'Pitch first.', 'One swing a pitch');

-- The count, set by hand: three balls, then ball four.
create function pg_temp.next_pitch(p_balls int, p_strikes int, p_in_zone boolean, p_pitch_no int default null) returns void language plpgsql as $$
declare a uuid;
begin
  select id into a from public.baseball_live_abs where challenge_id = '00000000-0000-0000-0000-00000000ba01' and status = 'open';
  update public.baseball_live_abs set balls = p_balls, strikes = p_strikes, pitches = coalesce(p_pitch_no - 1, pitches) where id = a;
end $$;
create function pg_temp.fix_pitch(p_in_zone boolean, p_pressure double precision default 0) returns void language sql as $$
  update public.baseball_live_pitches lp set in_zone = p_in_zone, pressure = p_pressure
  from public.baseball_live_abs a
  where a.id = lp.ab_id and a.challenge_id = '00000000-0000-0000-0000-00000000ba01' and a.status = 'open' and lp.call is null;
$$;
reset role;
select pg_temp.next_pitch(3, 1, false);
select tests.sign_in(:'ann');
set local role authenticated;
select public.baseball_pitch('00000000-0000-0000-0000-00000000ba01');
reset role;
select pg_temp.fix_pitch(false);
select tests.sign_in(:'ann');
set local role authenticated;
select is((select jsonb_build_object('call', s -> 'call', 'done', s -> 'done', 'result', s -> 'result' -> 'kind', 'message', s -> 'message')
  from public.baseball_swing('00000000-0000-0000-0000-00000000ba01', null) s),
  jsonb_build_object('call', 'ball', 'done', true, 'result', 'walk', 'message', 'Ball four: take your base.'), 'Ball four: a walk');
select is((select l -> 'abs' -> 0 ->> 'result' from public.baseball_live('00000000-0000-0000-0000-00000000ba01') l), 'walk',
  'It waits as a walk');
select is((select jsonb_build_object('taken', l -> 'taken', 'waiting', l -> 'waiting', 'ready', l -> 'ready')
  from public.baseball_live('00000000-0000-0000-0000-00000000ba01') l),
  jsonb_build_object('taken', 1, 'waiting', 1, 'ready', 1), 'One taken, one waiting, one ready');

-- Second at-bat: a called third strike.
select public.baseball_pitch('00000000-0000-0000-0000-00000000ba01') ->> 'ab' as ab2 \gset
select is(:'ab2'::int, 2, 'The next pitch opens the second at-bat');
reset role;
select pg_temp.next_pitch(0, 2, true);
select pg_temp.fix_pitch(true);
select tests.sign_in(:'ann');
set local role authenticated;
select is((select s ->> 'message' from public.baseball_swing('00000000-0000-0000-0000-00000000ba01', null) s), 'Strike three.', 'A called third strike');
select is(public.baseball_live('00000000-0000-0000-0000-00000000ba01') ->> 'reason', 'No at-bats ready: your next one comes at 9,000 steps.',
  'Two at-bats used: the next comes at 9,000');
reset role;
select pg_temp.steps(:'ann', 9100);
select tests.sign_in(:'ann');
set local role authenticated;

-- Third: a whiff, a two-strike foul that doesn't count, and the tenth-pitch tip.
select public.baseball_pitch('00000000-0000-0000-0000-00000000ba01');
reset role;
select pg_temp.fix_pitch(true);
select tests.sign_in(:'ann');
set local role authenticated;
select is((select jsonb_build_object('call', s -> 'call', 'strikes', s -> 'strikes', 'message', s -> 'message')
  from public.baseball_swing('00000000-0000-0000-0000-00000000ba01', 400) s),
  jsonb_build_object('call', 'whiff', 'strikes', 1, 'message', 'Missed it: you swung late.'), 'Way late: a whiff, strike one');
reset role;
select pg_temp.next_pitch(1, 2, true);
select tests.sign_in(:'ann');
set local role authenticated;
select public.baseball_pitch('00000000-0000-0000-0000-00000000ba01');
reset role;
select pg_temp.fix_pitch(true);
select tests.sign_in(:'ann');
set local role authenticated;
select is((select jsonb_build_object('call', s -> 'call', 'strikes', s -> 'strikes', 'done', s -> 'done', 'message', s -> 'message')
  from public.baseball_swing('00000000-0000-0000-0000-00000000ba01', -100) s),
  jsonb_build_object('call', 'foul', 'strikes', 2, 'done', false, 'message', 'Foul: close, but a little early.'), 'A foul with two strikes stays two');
reset role;
select pg_temp.next_pitch(1, 2, true, 10);
select tests.sign_in(:'ann');
set local role authenticated;
select is((public.baseball_pitch('00000000-0000-0000-0000-00000000ba01') ->> 'pitch_no')::int, 10, 'The tenth pitch');
reset role;
select pg_temp.fix_pitch(true);
select tests.sign_in(:'ann');
set local role authenticated;
select is((select jsonb_build_object('call', s -> 'call', 'done', s -> 'done', 'result', s -> 'result' -> 'kind', 'message', s -> 'message')
  from public.baseball_swing('00000000-0000-0000-0000-00000000ba01', 110) s),
  jsonb_build_object('call', 'foul', 'done', true, 'result', 'strikeout', 'message', 'Foul tip, caught: strike three.'),
  'From the tenth pitch on, a two-strike foul is a foul tip, caught');
select is(public.baseball_live('00000000-0000-0000-0000-00000000ba01') ->> 'reason', 'That''s all your at-bats today.', 'Three a day');
reset role;

-- In play: a perfectly timed swing is barrel contact (or a foul, by the
-- seeded share), pulled, straight or the other way by the timing.
delete from public.baseball_live_abs where challenge_id = '00000000-0000-0000-0000-00000000ba01' and n = 3;
select tests.sign_in(:'ann');
set local role authenticated;
select public.baseball_pitch('00000000-0000-0000-0000-00000000ba01');
reset role;
select pg_temp.fix_pitch(true);
select tests.sign_in(:'ann');
set local role authenticated;
select public.baseball_swing('00000000-0000-0000-0000-00000000ba01', 0) as s3 \gset
select is((:'s3'::jsonb) ->> 'call',
  case when public.baseball_rand('00000000-0000-0000-0000-00000000ba01:' || :'ann' || ':live:3:1:foul') < 0.20 then 'foul' else 'in_play' end,
  'On time: barrel contact, unless the seeded foul share says foul');
select ok((:'s3'::jsonb) ->> 'call' = 'foul'
  or ((:'s3'::jsonb) ->> 'contact' = 'barrel' and (:'s3'::jsonb) -> 'result' ->> 'aim' = 'center'
      and (:'s3'::jsonb) -> 'result' ->> 'kind' in ('home_run', 'single', 'double', 'triple', 'ground_out', 'fly_out')
      and (:'s3'::jsonb) ->> 'message' is not null),
  'and in play it goes up the middle, with a result and a message');
reset role;
select is((select count(*)::int from public.baseball_live_pitches lp join public.baseball_live_abs a on a.id = lp.ab_id
  where a.challenge_id = '00000000-0000-0000-0000-00000000ba01' and lp.call is not null and lp.timing_ms is not distinct from case when lp.call in ('ball', 'strike') then null else lp.timing_ms end),
  (select count(*)::int from public.baseball_live_pitches lp join public.baseball_live_abs a on a.id = lp.ab_id
  where a.challenge_id = '00000000-0000-0000-0000-00000000ba01' and lp.call is not null),
  'Every pitch keeps its call, and takes have no timing');

-- ── Can't bat ──
select tests.sign_in(:'ann');
set local role authenticated;
select is(public.baseball_live('00000000-0000-0000-0000-00000000ba02') ->> 'reason', 'This game plays itself.', 'Not in a hands-off game');
select throws_ok($$select public.baseball_pitch('00000000-0000-0000-0000-00000000ba02')$$, 'This game plays itself.', 'so no pitches there');
select is(public.baseball_live('00000000-0000-0000-0000-00000000ba03') ->> 'reason', 'This game is over.', 'Not once the game is over');
reset role;
select tests.sign_in(:'cat');
set local role authenticated;
select is(public.baseball_live('00000000-0000-0000-0000-00000000ba01') ->> 'reason', 'You''re not playing in this game.',
  'Not for someone named who hasn''t joined');
reset role;
select tests.sign_in(:'dan');
set local role authenticated;
select throws_ok($$select public.baseball_live('00000000-0000-0000-0000-00000000ba01')$$, 'not authorized', 'and nothing for someone outside it');
reset role;
-- Three already waiting from yesterday: no more until the order uses one.
insert into public.baseball_live_abs (challenge_id, user_id, team, n, day, status, result)
select '00000000-0000-0000-0000-00000000ba04', :'ann', 'a', k, :'today'::date - 1, 'done', 'strikeout' from generate_series(1, 3) k;
select tests.sign_in(:'ann');
set local role authenticated;
select is((select jsonb_build_object('reason', l -> 'reason', 'earned', l -> 'earned', 'waiting', l -> 'waiting', 'ready', l -> 'ready')
  from public.baseball_live('00000000-0000-0000-0000-00000000ba04') l),
  jsonb_build_object('reason', '3 at-bats waiting for your turn in the order.', 'earned', 3, 'waiting', 3, 'ready', 0),
  'Three waiting: no more for now');
select throws_ok($$select public.baseball_pitch('00000000-0000-0000-0000-00000000ba04')$$, '3 at-bats waiting for your turn in the order.',
  'and no pitch');
reset role;

-- ── The inning uses them ──
-- F: Cat, Dan and Eve bat first and each has a strikeout waiting, so the
-- top of the first ends before Ann; her home run waits. Next inning she
-- leads off with it.
select :'today'::date - 1 as d1 \gset
insert into public.baseball_live_abs (challenge_id, user_id, team, n, day, status, result, contact, aim, fielder_pos)
values ('00000000-0000-0000-0000-00000000ba06', :'cat', 'a', 1, :'d1', 'done', 'strikeout', null, null, null),
       ('00000000-0000-0000-0000-00000000ba06', :'dan', 'a', 1, :'d1', 'done', 'strikeout', null, null, null),
       ('00000000-0000-0000-0000-00000000ba06', :'eve', 'a', 1, :'d1', 'done', 'strikeout', null, null, null),
       ('00000000-0000-0000-0000-00000000ba06', :'ann', 'a', 1, :'d1', 'done', 'home_run', 'barrel', 'left', 'lf'),
       ('00000000-0000-0000-0000-00000000ba06', :'cat', 'a', 2, :'today', 'done', 'walk', null, null, null);
select is((select jsonb_build_object('runs', h.runs, 'next', h.next_cursor)
  from public.baseball_half('00000000-0000-0000-0000-00000000ba06', :'d1', :'d1', 1, 'top', 'a', 0, null) h),
  jsonb_build_object('runs', 0, 'next', 3), 'Three strikeouts by hand: three up, three down');
select is((select array_agg(kind || ':' || by_hand order by seq) from public.baseball_plays where challenge_id = '00000000-0000-0000-0000-00000000ba06'),
  array['strikeout:true', 'strikeout:true', 'strikeout:true'], 'each one played as taken, marked by hand');
select is((select array_agg(used_inning || used_half || used_seq order by user_id = :'cat' desc, user_id = :'dan' desc)
  from public.baseball_live_abs where challenge_id = '00000000-0000-0000-0000-00000000ba06' and used_day = :'d1'),
  array['1top1', '1top2', '1top3'], 'and marked used where they were played');
select is((select used_day from public.baseball_live_abs where challenge_id = '00000000-0000-0000-0000-00000000ba06' and user_id = :'ann'), null::date,
  'Ann''s didn''t come up: it waits');
select is((select used_day from public.baseball_live_abs where challenge_id = '00000000-0000-0000-0000-00000000ba06' and user_id = :'cat' and n = 2), null::date,
  'and one taken today isn''t used on an earlier day');
select public.baseball_half('00000000-0000-0000-0000-00000000ba06', :'today', :'d1', 2, 'top', 'a', 3, null);
select is((select kind || ':' || by_hand || ':' || fielder_pos || ':' || runs from public.baseball_plays
  where challenge_id = '00000000-0000-0000-0000-00000000ba06' and inning = 2 order by seq limit 1),
  'home_run:true:lf:1', 'Next inning Ann leads off with her home run, to left');
select is((select kind || ':' || by_hand from public.baseball_plays
  where challenge_id = '00000000-0000-0000-0000-00000000ba06' and inning = 2 and batter_id = :'cat' order by seq limit 1),
  'walk:true', 'then Cat''s walk from today');
select is((select count(*)::int from public.baseball_plays where challenge_id = '00000000-0000-0000-0000-00000000ba06' and inning = 2 and by_hand),
  2, 'and the rest are rolled as before');
select is((select count(*)::int from public.baseball_live_abs where challenge_id = '00000000-0000-0000-0000-00000000ba06' and used_day is null),
  0, 'Nothing left waiting');

-- G: hands-off, the same at-bats sitting there are never used.
insert into public.baseball_live_abs (challenge_id, user_id, team, n, day, status, result)
select '00000000-0000-0000-0000-00000000ba07', u, 'a', 1, :'d1', 'done', 'strikeout' from unnest(array[:'cat', :'dan', :'eve', :'ann']::uuid[]) u;
select public.baseball_half('00000000-0000-0000-0000-00000000ba07', :'d1', :'d1', 1, 'top', 'a', 0, null);
select is((select count(*)::int from public.baseball_plays where challenge_id = '00000000-0000-0000-0000-00000000ba07' and by_hand), 0,
  'A hands-off game plays as before');
select is((select count(*)::int from public.baseball_live_abs where challenge_id = '00000000-0000-0000-0000-00000000ba07' and used_day is not null), 0,
  'and uses nothing');

-- A whole day through baseball_play_day: B (hands-off) still plays.
select lives_ok($$select public.baseball_play_day('00000000-0000-0000-0000-00000000ba02', '$$ || :'d1' || $$', 1, '$$ || :'d1' || $$')$$,
  'A hands-off day plays');
select is((select count(*)::int from public.baseball_plays where challenge_id = '00000000-0000-0000-0000-00000000ba02' and by_hand), 0,
  'with nothing by hand');

-- ── Admin ──
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.admin_baseball_overview()$$, 'not authorized', 'Admin only');
reset role;
select tests.sign_in(:'ada');
set local role authenticated;
select is((select (o -> 'live') - 'auto_avg_7d' - 'avg_7d' from public.admin_baseball_overview() o),
  jsonb_build_object('games_hands_on', 3, 'people_7d', 4, 'at_bats_7d', (select count(*) from public.baseball_live_abs where status = 'done'), 'pitches_7d',
    (select count(*) from public.baseball_live_pitches), 'hr_7d',
    (select count(*) from public.baseball_live_abs where result = 'home_run')),
  'Admin: hands-on games, people, at-bats, pitches and home runs this week');
select ok((select (o -> 'live' ->> 'avg_7d')::numeric between 0 and 1 from public.admin_baseball_overview() o),
  'and the average by hand');
select ok((select o -> 'live' ? 'auto_avg_7d' from public.admin_baseball_overview() o), 'beside the rolled one');
reset role;

select * from finish();
