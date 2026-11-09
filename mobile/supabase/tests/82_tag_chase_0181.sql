-- 0181: Game of Tag as a daily chase. A random first IT; IT tags whoever
-- it out-walks by more than the head start; the slowest tagged is IT
-- next, or IT stays; +3 a tag, +1 a day got away; it ends when the last
-- day is settled, placed by points.
select plan(18);

select tests.new_user('Ann', true) as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
select tests.new_user('Dan') as dan \gset
select tests.new_user('Eve') as eve \gset

-- Three days, all over everywhere (like the Baseball test).
select (now() at time zone 'utc')::date
  - case when extract(hour from now() at time zone 'utc') >= 11 then 1 else 2 end as cutoff \gset
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day, tag_mode, tag_head_start) values
  ('00000000-0000-0000-0000-0000000000e1', 'Fam chase', 'tag', :'ann', 3,
   (:'cutoff'::date - 2)::timestamp at time zone 'utc', (:'cutoff'::date + 1)::timestamp at time zone 'utc', :'cutoff'::date - 2,
   'chase', 2000);
insert into public.challenge_participants (challenge_id, user_id) values
  ('00000000-0000-0000-0000-0000000000e1', :'ann'), ('00000000-0000-0000-0000-0000000000e1', :'bob'),
  ('00000000-0000-0000-0000-0000000000e1', :'cat'), ('00000000-0000-0000-0000-0000000000e1', :'dan');

select is((select count(*)::int from public.tag_rounds where challenge_id = '00000000-0000-0000-0000-0000000000e1'), 0,
  'A chase has no old-style round');
select throws_ok($$ insert into public.challenges (name, kind, created_by, duration_days, starts_at, ends_at, tag_mode)
  values ('Too long', 'tag', '$$ || :'ann' || $$', 20, now(), now() + interval '20 days', 'chase') $$, '23514', null, 'A chase runs 3 to 14 days');
select ok((select public.tag_chase_it('00000000-0000-0000-0000-0000000000e1') in (:'ann', :'bob', :'cat', :'dan')), 'The first IT is one of the players');
-- Ann starts as IT, for the steps below.
update public.tag_chase_state set it_user = :'ann' where challenge_id = '00000000-0000-0000-0000-0000000000e1';

-- Day 1, Ann IT on 10,000: Bob 7,000 and Dan 5,000 tagged, Cat 9,000 away.
-- Day 2, Dan IT on 8,000: Bob 3,000 tagged; Ann 7,000 and Cat 6,500 away.
-- Day 3, Bob IT on 4,000: nobody tagged.
insert into public.progress_snapshots (challenge_id, user_id, day, steps)
select '00000000-0000-0000-0000-0000000000e1', u, :'cutoff'::date - (2 - d), s
from (values
  (:'ann'::uuid, 0, 10000), (:'bob'::uuid, 0, 7000), (:'cat'::uuid, 0, 9000), (:'dan'::uuid, 0, 5000),
  (:'ann'::uuid, 1, 7000), (:'bob'::uuid, 1, 3000), (:'cat'::uuid, 1, 6500), (:'dan'::uuid, 1, 8000),
  (:'ann'::uuid, 2, 6000), (:'bob'::uuid, 2, 4000), (:'cat'::uuid, 2, 5000), (:'dan'::uuid, 2, 3000)
) v(u, d, s);

select tests.sign_in(:'eve');
set local role authenticated;
select throws_ok(format('select public.tag_chase_view(%L, current_date)', '00000000-0000-0000-0000-0000000000e1'),
  'Join the challenge first.', 'Only players see the game');
reset role;

select tests.sign_in(:'cat');
set local role authenticated;
select public.tag_chase_view('00000000-0000-0000-0000-0000000000e1', current_date) as v \gset
reset role;

select is(jsonb_array_length(:'v'::jsonb -> 'history'), 3, 'All three days are settled');
select is(:'v'::jsonb -> 'history' -> 0 -> 'tagged' -> 0 ->> 'user', :'dan', 'Day 1: Dan, the slowest, is tagged first');
select is(jsonb_array_length(:'v'::jsonb -> 'history' -> 0 -> 'tagged'), 2, 'Ann tags two');
select is((:'v'::jsonb -> 'history' -> 0 -> 'tagged' -> 0 ->> 'margin')::int, -3000, 'Dan by 3,000 (5,000 + 2,000 vs 10,000)');
select is(:'v'::jsonb -> 'history' -> 0 -> 'escaped' -> 0 ->> 'user', :'cat', 'Cat gets away');
select is(:'v'::jsonb -> 'history' -> 0 ->> 'next_it', :'dan', 'and Dan is IT on day 2');
select is(:'v'::jsonb -> 'history' -> 1 ->> 'next_it', :'bob', 'Bob, tagged on day 2, is IT on day 3');
select is(:'v'::jsonb -> 'history' -> 2 ->> 'next_it', :'bob', 'Nobody tagged on day 3: Bob stays IT');
select is(:'v'::jsonb ->> 'it', :'bob', 'Bob is IT now');

select is((select points from public.tag_chase_standings('00000000-0000-0000-0000-0000000000e1') where user_id = :'ann'), 8,
  'Ann: two tags and two days away, 8 points');
select is((select points::text || '/' || days_it::text from public.tag_chase_standings('00000000-0000-0000-0000-0000000000e1') where user_id = :'bob'), '0/1',
  'Bob: tagged twice, then IT');
select is(:'v'::jsonb -> 'standings' -> 0 ->> 'user', :'ann', 'Ann leads');

-- Over: settled by points.
select public.settle_challenge_score('00000000-0000-0000-0000-0000000000e1');
select is((select score_points from public.activity_events where challenge_id = '00000000-0000-0000-0000-0000000000e1' and user_id = :'ann' and kind = 'tag_result'),
  50, 'The winner scores like a Step Race winner');

select tests.sign_in(:'ann');
set local role authenticated;
select ok((public.admin_tag_overview() ->> 'tags_7d')::int >= 3, 'Admin sees the tags');
reset role;

select * from finish();
