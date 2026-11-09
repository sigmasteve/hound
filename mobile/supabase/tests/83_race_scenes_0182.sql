-- 0182: the scene a Tag or Chase game is raced on; Admin counts them.
select plan(4);

select tests.new_user('Ann', true) as ann \gset
select tests.new_user('Bob') as bob \gset

insert into public.challenges (name, kind, created_by, duration_days, starts_at, ends_at, race_scene, tag_mode, tag_head_start) values
  ('Beach tag', 'tag', :'ann', 7, now(), now() + interval '7 days', 'beach', 'chase', 2000),
  ('Old tag', 'tag', :'ann', 7, now(), now() + interval '7 days', null, 'chase', 2000);
insert into public.challenges (name, kind, created_by, duration_days, starts_at, ends_at, race_scene) values
  ('Mountain chase', 'hunt', :'bob', 7, now(), now() + interval '7 days', 'mountains');

select throws_ok($$ insert into public.challenges (name, kind, created_by, duration_days, starts_at, ends_at, race_scene)
  values ('Moon', 'hunt', '$$ || :'ann' || $$', 7, now(), now() + interval '7 days', 'moon') $$, '23514', null, 'Only the four scenes');

select tests.sign_in(:'ann');
set local role authenticated;
select public.admin_challenges_overview() as o \gset
reset role;
select ok((:'o'::jsonb -> 'scenes' -> 'tag' ->> 'beach')::int >= 1, 'A Tag game on the beach');
select ok((:'o'::jsonb -> 'scenes' -> 'tag' ->> 'track')::int >= 1, 'An empty scene counts as the track for Tag');
select ok((:'o'::jsonb -> 'scenes' -> 'hunt' ->> 'mountains')::int >= 1, 'and a Chase in the mountains');

select * from finish();
