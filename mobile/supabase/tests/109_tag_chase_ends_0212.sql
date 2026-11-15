-- 0212: a Tag chase ends when its last day is settled, not at ends_at
-- (which a chase started "Now" puts on the day after its last day).
select plan(4);

select tests.new_user('Dad') as dad \gset
select tests.new_user('Sky') as sky \gset

select (now() at time zone 'utc')::date
  - case when extract(hour from now() at time zone 'utc') >= 11 then 1 else 2 end as cutoff \gset

-- A: three days, all over; its ends_at is still hours away (started "Now").
-- B: five days, only three over.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day, tag_mode, tag_head_start) values
  ('00000000-0000-0000-0000-0000000012a1', 'Done chase', 'tag', :'dad', 3,
   (:'cutoff'::date - 2)::timestamp at time zone 'utc', now() + interval '3 hours', :'cutoff'::date - 2, 'chase', 1000),
  ('00000000-0000-0000-0000-0000000012a2', 'Going chase', 'tag', :'dad', 5,
   (:'cutoff'::date - 2)::timestamp at time zone 'utc', (:'cutoff'::date + 3)::timestamp at time zone 'utc', :'cutoff'::date - 2, 'chase', 1000);
insert into public.challenge_participants (challenge_id, user_id)
select c, u from unnest(array['00000000-0000-0000-0000-0000000012a1', '00000000-0000-0000-0000-0000000012a2']::uuid[]) c,
  unnest(array[:'dad', :'sky']::uuid[]) u;
insert into public.tag_chase_state (challenge_id, it_user) values
  ('00000000-0000-0000-0000-0000000012a1', :'dad'), ('00000000-0000-0000-0000-0000000012a2', :'dad');
insert into public.progress_snapshots (challenge_id, user_id, day, steps)
select c, u, :'cutoff'::date - d, s
from unnest(array['00000000-0000-0000-0000-0000000012a1', '00000000-0000-0000-0000-0000000012a2']::uuid[]) c,
  (values (:'dad'::uuid, 0, 6000), (:'sky'::uuid, 0, 3000), (:'dad'::uuid, 1, 5000), (:'sky'::uuid, 1, 4000), (:'dad'::uuid, 2, 7000), (:'sky'::uuid, 2, 2000)) v(u, d, s);

select is(public.tag_chase_advance('00000000-0000-0000-0000-0000000012a1'), 3, 'all three days of the finished chase settle');
select ok((select ends_at <= now() from public.challenges where id = '00000000-0000-0000-0000-0000000012a1'),
  'its last day settled, so the challenge ends now, not hours later');

select public.tag_chase_advance('00000000-0000-0000-0000-0000000012a2');
select ok((select ends_at > now() from public.challenges where id = '00000000-0000-0000-0000-0000000012a2'),
  'a chase with days left keeps its end');

-- A game already finished before 0212 ends the next time it's advanced.
update public.challenges set ends_at = now() + interval '2 hours' where id = '00000000-0000-0000-0000-0000000012a1';
select public.tag_chase_advance('00000000-0000-0000-0000-0000000012a1');
select ok((select ends_at <= now() from public.challenges where id = '00000000-0000-0000-0000-0000000012a1'),
  'an already-finished chase ends on its next advance');

select * from finish();
