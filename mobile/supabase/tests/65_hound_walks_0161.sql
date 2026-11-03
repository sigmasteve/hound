-- 0161: walks saved from the phone, merged as they grow, finds for
-- finished walks (in season, at most 5 a day), the collection, events,
-- and the admin overview.
select plan(15);

select tests.new_user('Ann', true) as ann \gset
select tests.new_user('Bo') as bo \gset
select current_date as today \gset

-- A walk helper: started m1 minutes ago, ended m2 minutes ago.
create function pg_temp.walk(m1 int, m2 int, steps int) returns jsonb language sql as $$
  select jsonb_build_object(
    'start', now() - make_interval(mins => m1),
    'end', now() - make_interval(mins => m2),
    'start_minute', 600,
    'steps', steps,
    'distance_m', steps * 3 / 4);
$$;

select tests.sign_in(:'bo');
set local role authenticated;

-- A finished 30-minute walk, and one still going.
select is(jsonb_array_length(public.save_hound_walks(:'today', jsonb_build_array(pg_temp.walk(200, 170, 3200), pg_temp.walk(30, 0, 1500))) -> 'walks'), 2,
  'Two walks are saved');
select is((select count(*)::int from jsonb_array_elements(public.my_walks(:'today') -> 'walks') x where x ->> 'find_id' is not null), 1,
  'Only the finished walk found something');
select ok((select (x ->> 'walking')::boolean from jsonb_array_elements(public.my_walks(:'today') -> 'walks') x order by x ->> 'started_at' desc limit 1),
  'The one still going shows as walking');

-- The same first walk again, longer: it grows, keeping its find.
select (select x ->> 'find_id' from jsonb_array_elements(public.my_walks(:'today') -> 'walks') x where x ->> 'find_id' is not null) as first_find \gset
select is(jsonb_array_length(public.save_hound_walks(:'today', jsonb_build_array(pg_temp.walk(210, 165, 4100))) -> 'walks'), 2,
  'A walk that overlaps a saved one grows it');
select is((select x ->> 'find_id' from jsonb_array_elements(public.my_walks(:'today') -> 'walks') x where (x ->> 'steps')::int = 4100), :'first_find',
  'and keeps what it found');

-- Too fast to be walking, and too short.
select is(jsonb_array_length(public.save_hound_walks(:'today', jsonb_build_array(pg_temp.walk(400, 390, 9000), pg_temp.walk(500, 497, 300))) -> 'walks'), 2,
  'Implausible walks are left out');

-- Seven more finished walks: finds stop at 5 a day.
select public.save_hound_walks(:'today', jsonb_build_array(
  pg_temp.walk(1000, 985, 1500), pg_temp.walk(960, 945, 1500), pg_temp.walk(920, 905, 1500),
  pg_temp.walk(880, 865, 1500), pg_temp.walk(840, 825, 1500), pg_temp.walk(800, 785, 1500),
  pg_temp.walk(760, 745, 1500))) is not null as saved \gset
reset role;
select is((select count(*)::int from public.hound_walks h where h.user_id = :'bo' and h.day = :'today' and h.find_id is not null), 5,
  'At most 5 finds a day');
select ok(not exists (
    select 1 from public.hound_walks h join public.walk_find_kinds k on k.id = h.find_id
    where h.user_id = :'bo' and k.season is not null and k.season <> public.walk_season(h.day)),
  'Every find is in season');

select tests.sign_in(:'bo');
set local role authenticated;
select is((select sum((f ->> 'count')::int)::int from jsonb_array_elements(public.my_walks(:'today') -> 'finds') f), 5,
  'The collection counts every find');
select is(jsonb_array_length(public.my_walks(:'today') -> 'kinds'), 22, 'All 22 kinds come with it');
select is(jsonb_array_length(public.save_hound_walks(:'today'::date - 10, jsonb_build_array(pg_temp.walk(100, 70, 3000))) -> 'walks'), 0,
  'A walk for an old day is ignored');

select lives_ok($$ select public.log_walk_event('diary_open'); select public.log_walk_event('diary_open') $$,
  'Opening the diary twice in a day is fine');
select throws_ok($$ select public.admin_walks_overview() $$, 'not authorized', 'Members can''t see the overview');
reset role;
select is((select count(*)::int from public.walk_events v where v.user_id = :'bo'), 1, 'and counts once');

select tests.sign_in(:'ann');
set local role authenticated;
select is((public.admin_walks_overview() ->> 'walkers_7d')::int, 1, 'The admin sees one walker this week');
reset role;

select * from finish();
