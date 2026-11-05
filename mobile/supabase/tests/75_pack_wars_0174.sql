-- 0174: Pack Wars. Even packs on joining, each on its corner; votes (only
-- reachable ground, only today, only members); the night's marches (open
-- ground, a Hold's full defence, half while marching); the phone's steps;
-- settling with Admin's Bones; publishing; the admin overview.
select plan(30);

select tests.new_user('Ann', true) as ann \gset
select (now() at time zone 'utc')::date as today \gset
create temp table people as select tests.new_user('P' || g) as id, g from generate_series(1, 8) g;
update public.profiles set time_zone = 'UTC' where id in (select id from people) or id = :'ann';

-- P: played day by day below. Q: today is day 1, for voting.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day, is_global, join_closes_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'Pack Wars P', 'packs', :'ann', 7, (:'today'::date - 6)::timestamp at time zone 'utc', (:'today'::date + 1)::timestamp at time zone 'utc', :'today'::date - 6, true, now() + interval '1 day'),
  ('00000000-0000-0000-0000-0000000000a2', 'Pack Wars Q', 'packs', :'ann', 7, :'today'::timestamp at time zone 'utc', (:'today'::date + 7)::timestamp at time zone 'utc', :'today'::date, true, now() + interval '1 day');
insert into public.challenge_participants (challenge_id, user_id)
select '00000000-0000-0000-0000-0000000000a1', id from people order by g;
insert into public.challenge_participants (challenge_id, user_id)
select '00000000-0000-0000-0000-0000000000a2', id from people order by g;

select is((select array_agg(n order by n) from (select count(*) as n from public.pack_members where challenge_id = '00000000-0000-0000-0000-0000000000a1' group by pack) x),
  array[2, 2, 2, 2]::bigint[], 'Eight people, four packs of two');
select is((select array_agg(owner order by idx) from public.pack_territories where challenge_id = '00000000-0000-0000-0000-0000000000a1' and owner is not null),
  array['wolves', 'goldens', 'collies', 'beagles'], 'Each pack starts on its corner');
select is((select count(*) from public.pack_territories where challenge_id = '00000000-0000-0000-0000-0000000000a1' and owner is null), 20::bigint, 'and the rest is open ground');
select is(public.pack_neighbors(0), array[6, 1], 'The top-left corner touches two');
select is(public.pack_neighbors(8), array[2, 14, 7, 9], 'A middle one touches four');

-- Voting, on Q.
select user_id as w from public.pack_members where challenge_id = '00000000-0000-0000-0000-0000000000a2' and pack = 'wolves' order by user_id limit 1 \gset
select tests.sign_in(:'w');
set local role authenticated;
select throws_ok($$select public.pack_vote('00000000-0000-0000-0000-0000000000a2', (now() at time zone 'utc')::date, 23)$$,
  'Your pack can''t reach that one yet.', 'Not ground you can''t reach');
select throws_ok($$select public.pack_vote('00000000-0000-0000-0000-0000000000a2', (now() at time zone 'utc')::date, 0)$$,
  'Your pack can''t reach that one yet.', 'Not ground you already hold');
select throws_ok($$select public.pack_vote('00000000-0000-0000-0000-0000000000a2', (now() at time zone 'utc')::date + 1, 1)$$,
  'You can only vote for today.', 'Only today');
select lives_ok($$select public.pack_vote('00000000-0000-0000-0000-0000000000a2', (now() at time zone 'utc')::date, 1)$$, 'A march next door');
select lives_ok($$select public.pack_vote('00000000-0000-0000-0000-0000000000a2', (now() at time zone 'utc')::date, -1)$$, 'and a change of mind to Hold');
select lives_ok($$select public.pack_claim_steps('00000000-0000-0000-0000-0000000000a2', (now() at time zone 'utc')::date, 9100)$$, 'The phone reports its steps');
select public.pack_state('00000000-0000-0000-0000-0000000000a2', :'today') as st \gset
reset role;
select is((select row(target, steps)::text from public.pack_votes where user_id = :'w' and challenge_id = '00000000-0000-0000-0000-0000000000a2'), '(-1,9100)',
  'One vote, the latest, with the phone''s steps');
select is(:'st'::jsonb ->> 'myPack', 'wolves', 'The state says which pack');
select is((:'st'::jsonb ->> 'votedToday')::int, 1, 'and how many of it voted');
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.pack_vote('00000000-0000-0000-0000-0000000000a2', (now() at time zone 'utc')::date, 1)$$,
  'Join the challenge to vote.', 'Only members vote');
reset role;

-- Nights, on P. Votes go in directly, with the steps on them.
create temp table packof as select user_id, pack, row_number() over (partition by pack order by user_id) as n
  from public.pack_members where challenge_id = '00000000-0000-0000-0000-0000000000a1';
create or replace function pg_temp.vote(p_pack text, p_n int, p_day int, p_target int, p_steps int) returns void language sql as $$
  insert into public.pack_votes (challenge_id, user_id, day, target, steps)
  select '00000000-0000-0000-0000-0000000000a1', user_id, (now() at time zone 'utc')::date - 6 + p_day - 1, p_target, p_steps
  from packof where pack = p_pack and n = p_n;
$$;
-- Night 1: everyone onto open ground.
select pg_temp.vote('wolves', 1, 1, 1, 8000), pg_temp.vote('wolves', 2, 1, 1, 8000),
       pg_temp.vote('goldens', 1, 1, 4, 6000),
       pg_temp.vote('collies', 1, 1, 12, 5000), pg_temp.vote('collies', 2, 1, 12, 5000),
       pg_temp.vote('beagles', 1, 1, 22, 2000);
select is(public.pack_strength('00000000-0000-0000-0000-0000000000a1', 'goldens', :'today'::date - 6), 3000,
  'Strength is the voters'' steps over every member: one voter''s 6,000 over two');
select is(public.pack_play_day('00000000-0000-0000-0000-0000000000a1', :'today'::date - 6), 4, 'Night 1: four marches, four taken');
select is((select array_agg(owner order by idx) from public.pack_territories where challenge_id = '00000000-0000-0000-0000-0000000000a1' and idx in (1, 4, 12, 22)),
  array['wolves', 'goldens', 'collies', 'beagles'], 'each where its pack marched');
select is(public.pack_play_day('00000000-0000-0000-0000-0000000000a1', :'today'::date - 6), 0, 'A night plays once');
-- Night 2: the Wolves to 2, the Goldens to 3.
select pg_temp.vote('wolves', 1, 2, 2, 8000), pg_temp.vote('wolves', 2, 2, 2, 8000),
       pg_temp.vote('goldens', 1, 2, 3, 5000), pg_temp.vote('goldens', 2, 2, 3, 5000);
select public.pack_play_day('00000000-0000-0000-0000-0000000000a1', :'today'::date - 5);
-- Night 3: the Goldens attack 2; the Wolves hold with 8,000.
select pg_temp.vote('wolves', 1, 3, -1, 8000), pg_temp.vote('wolves', 2, 3, -1, 8000),
       pg_temp.vote('goldens', 1, 3, 2, 5000), pg_temp.vote('goldens', 2, 3, 2, 5000);
select is(public.pack_play_day('00000000-0000-0000-0000-0000000000a1', :'today'::date - 4), 0, 'Night 3: nothing taken');
select is((select owner from public.pack_territories where challenge_id = '00000000-0000-0000-0000-0000000000a1' and idx = 2), 'wolves',
  'A Hold defends with the pack''s full strength');
-- Night 4: the Wolves march on 7, leaving half behind; the Goldens attack 2 again.
select pg_temp.vote('wolves', 1, 4, 7, 8000), pg_temp.vote('wolves', 2, 4, 7, 8000),
       pg_temp.vote('goldens', 1, 4, 2, 5000), pg_temp.vote('goldens', 2, 4, 2, 5000);
select public.pack_play_day('00000000-0000-0000-0000-0000000000a1', :'today'::date - 3);
select is((select owner from public.pack_territories where challenge_id = '00000000-0000-0000-0000-0000000000a1' and idx = 2), 'goldens',
  'Marching elsewhere leaves half to defend: 5,000 beats 4,000');
select is((select row(pack, from_pack, strength, beat)::text from public.pack_moves where challenge_id = '00000000-0000-0000-0000-0000000000a1' and idx = 2 and day = :'today'::date - 3),
  '(goldens,wolves,5000,4000)', 'and the morning says so');
select is((select owner from public.pack_territories where challenge_id = '00000000-0000-0000-0000-0000000000a1' and idx = 7), 'wolves', 'while the Wolves took 7');

-- Settling: the Goldens hold 4 (5, 4, 3, 2), the most.
select tests.sign_in((select id from people where g = 1));
set local role authenticated;
update public.pack_settings set win_bones = 500 where id;
reset role;
select is((select win_bones from public.pack_settings), 50, 'Only an admin changes the Pack Wars Bones');
select tests.sign_in(:'ann');
set local role authenticated;
update public.pack_settings set win_bones = 60, finish_bones = 15 where id;
reset role;
update public.challenges set ends_at = now() - interval '2 days' where id = '00000000-0000-0000-0000-0000000000a1';
select public.settle_challenge_score_core('00000000-0000-0000-0000-0000000000a1');
select is((select array_agg(distinct e.bones_points) from public.activity_events e join packof p on p.user_id = e.user_id
           where e.challenge_id = '00000000-0000-0000-0000-0000000000a1' and e.kind = 'packs_result' and p.pack = 'goldens'),
  array[65], 'The winning pack: Admin''s 60 and the usual 5');
select is((select array_agg(distinct e.bones_points) from public.activity_events e join packof p on p.user_id = e.user_id
           where e.challenge_id = '00000000-0000-0000-0000-0000000000a1' and e.kind = 'packs_result' and p.pack <> 'goldens'),
  array[20], 'everyone else: Admin''s 15 and the usual 5');

-- Publishing and the overview.
select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok($$select public.publish_global_challenge('Pack Wars', 'packs', 14, now() + interval '1 day', now() + interval '4 days')$$,
  'An admin publishes a Pack Wars');
select throws_ok($$select public.publish_global_challenge('Too short', 'packs', 5, now() + interval '1 day', now() + interval '2 days')$$,
  'Pack Wars runs 7 to 30 days.', 'At least a week');
select is((public.admin_packs_overview() ->> 'joined')::int, 16, 'The overview counts everyone in a pack');
reset role;

select * from finish();
