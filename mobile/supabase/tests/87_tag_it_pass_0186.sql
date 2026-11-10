-- 0186: IT can't sit out. Nobody tagged and IT under 1,000 steps: IT
-- passes to the closest call among those who walked 1,000 or more; if
-- nobody did, IT stays. A game stuck when 0186 runs is fixed then.
select plan(7);

select tests.new_user('Dad') as dad \gset
select tests.new_user('Sky') as sky \gset
select tests.new_user('Ste') as ste \gset
select tests.new_user('Mom') as mom \gset

select (now() at time zone 'utc')::date
  - case when extract(hour from now() at time zone 'utc') >= 11 then 1 else 2 end as cutoff \gset

-- Five days, three of them over. Dad is IT.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day, tag_mode, tag_head_start) values
  ('00000000-0000-0000-0000-0000000000f1', 'Fam chase', 'tag', :'ste', 5,
   (:'cutoff'::date - 2)::timestamp at time zone 'utc', (:'cutoff'::date + 3)::timestamp at time zone 'utc', :'cutoff'::date - 2,
   'chase', 1000);
insert into public.challenge_participants (challenge_id, user_id) values
  ('00000000-0000-0000-0000-0000000000f1', :'dad'), ('00000000-0000-0000-0000-0000000000f1', :'sky'),
  ('00000000-0000-0000-0000-0000000000f1', :'ste'), ('00000000-0000-0000-0000-0000000000f1', :'mom');
insert into public.tag_chase_state (challenge_id, it_user) values ('00000000-0000-0000-0000-0000000000f1', :'dad');

-- Day 1: Dad 300 (not syncing). Sky 4,000, Ste 9,000, Mom 600.
-- Day 2: Sky IT on 5,000 tags Mom (500); she's IT.
-- Day 3: Mom IT on 200; nobody walks 1,000 (a quiet day): Mom stays.
insert into public.progress_snapshots (challenge_id, user_id, day, steps)
select '00000000-0000-0000-0000-0000000000f1', u, :'cutoff'::date - (2 - d), s
from (values
  (:'dad'::uuid, 0, 300), (:'sky'::uuid, 0, 4000), (:'ste'::uuid, 0, 9000), (:'mom'::uuid, 0, 600),
  (:'dad'::uuid, 1, 2000), (:'sky'::uuid, 1, 5000), (:'ste'::uuid, 1, 7000), (:'mom'::uuid, 1, 500),
  (:'dad'::uuid, 2, 400), (:'sky'::uuid, 2, 900), (:'ste'::uuid, 2, 800), (:'mom'::uuid, 2, 200)
) v(u, d, s);

select public.tag_chase_advance('00000000-0000-0000-0000-0000000000f1');

select is((select next_it from public.tag_chase_days where challenge_id = '00000000-0000-0000-0000-0000000000f1' and day_no = 1), :'sky'::uuid,
  'Dad under 1,000 and nobody tagged: IT passes to the closest call who walked 1,000+ (Sky, not Mom on 600)');
select is((select passed from public.tag_chase_days where challenge_id = '00000000-0000-0000-0000-0000000000f1' and day_no = 1), true,
  'and the day says IT passed');
select is((select next_it from public.tag_chase_days where challenge_id = '00000000-0000-0000-0000-0000000000f1' and day_no = 2), :'mom'::uuid,
  'A tag still decides it: the slowest tagged is IT');
select is((select passed from public.tag_chase_days where challenge_id = '00000000-0000-0000-0000-0000000000f1' and day_no = 2), false,
  'which isn''t a pass');
select is((select next_it from public.tag_chase_days where challenge_id = '00000000-0000-0000-0000-0000000000f1' and day_no = 3), :'mom'::uuid,
  'Nobody walked 1,000: IT stays');
select is(public.tag_chase_next_it(:'dad', 4000, jsonb_build_object(:'dad', 4000, :'sky', 3000), '[]'::jsonb), :'dad'::uuid,
  'IT on 1,000+ who tags nobody stays IT, as before');

-- tag_chase_view hands the app the pass.
select tests.sign_in(:'sky');
set local role authenticated;
select is((public.tag_chase_view('00000000-0000-0000-0000-0000000000f1', :'cutoff'::date + 1)->'history'->0->>'passed')::boolean, true,
  'The game''s history says which days IT passed');
reset role;

select * from finish();
