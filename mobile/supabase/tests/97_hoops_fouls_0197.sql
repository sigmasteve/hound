-- 0197: a foul needs a defender who walked (1,000 steps or more that day).
select plan(2);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Cat') as cat \gset
select (now() at time zone 'utc')::date
  - case when extract(hour from now() at time zone 'utc') >= 11 then 1 else 2 end as cutoff \gset

-- Two one-on-one games: Cat walks nothing in the first, 3,000 a day in the second.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-0000000000f1', 'No steps', 'hoops', :'ann', 4,
   (:'cutoff'::date - 5)::timestamp at time zone 'utc', (:'cutoff'::date - 1)::timestamp at time zone 'utc', :'cutoff'::date - 5),
  ('00000000-0000-0000-0000-0000000000f2', 'Some steps', 'hoops', :'ann', 4,
   (:'cutoff'::date - 5)::timestamp at time zone 'utc', (:'cutoff'::date - 1)::timestamp at time zone 'utc', :'cutoff'::date - 5);
insert into public.challenge_participants (challenge_id, user_id) values
  ('00000000-0000-0000-0000-0000000000f1', :'ann'), ('00000000-0000-0000-0000-0000000000f2', :'ann');

select tests.sign_in(:'ann');
set local role authenticated;
select public.hoops_setup(g, 2000, 1, false, ('[{"user_id":"' || :'ann' || '","team":"home"},{"user_id":"' || :'cat' || '","team":"away"}]')::jsonb)
from unnest(array['00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2']::uuid[]) g;
reset role;
insert into public.challenge_participants (challenge_id, user_id) values
  ('00000000-0000-0000-0000-0000000000f1', :'cat'), ('00000000-0000-0000-0000-0000000000f2', :'cat');

insert into public.progress_snapshots (challenge_id, user_id, day, steps)
select g, u, :'cutoff'::date - 5 + k, s
from (values ('00000000-0000-0000-0000-0000000000f1'::uuid, :'ann'::uuid, 10000), ('00000000-0000-0000-0000-0000000000f1'::uuid, :'cat'::uuid, 0),
             ('00000000-0000-0000-0000-0000000000f2'::uuid, :'ann'::uuid, 10000), ('00000000-0000-0000-0000-0000000000f2'::uuid, :'cat'::uuid, 3000)) v(g, u, s)
cross join generate_series(0, 5) k;

select tests.sign_in(:'ann');
set local role authenticated;
select public.hoops_advance('00000000-0000-0000-0000-0000000000f1');
select public.hoops_advance('00000000-0000-0000-0000-0000000000f2');
reset role;

select is((select count(*)::int from public.hoops_events where challenge_id = '00000000-0000-0000-0000-0000000000f1' and kind = 'ft'), 0,
  'A defender with no steps never fouls');
select is((select count(*)::int from public.hoops_events where challenge_id = '00000000-0000-0000-0000-0000000000f2' and kind = 'ft' and day_no = 1), 2,
  'A defender who walked, at half your steps or less, still fouls');

select * from finish();
