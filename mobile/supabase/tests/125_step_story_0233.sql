-- 0233: step challenges' options (rivals and bounties on, blackout off
-- by default), the story log (participants only, once a day per kind,
-- known kinds only, own rows only), and Admin.
select plan(10);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Ada', true) as ada \gset

insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at)
values ('00000000-0000-0000-0000-0000000057e1', 'Shuffle', 'steps', :'ann', 7, now() - interval '2 days', now() + interval '5 days'),
       ('00000000-0000-0000-0000-0000000057e2', 'Pool', 'distance', :'ann', 7, now() - interval '2 days', now() + interval '5 days');
update public.challenges set blackout_last_day = true where id = '00000000-0000-0000-0000-0000000057e2';
insert into public.challenge_participants (challenge_id, user_id) values
  ('00000000-0000-0000-0000-0000000057e1', :'ann'), ('00000000-0000-0000-0000-0000000057e2', :'ann');

select is((select array[step_rivals, step_bounties, blackout_last_day] from public.challenges where id = '00000000-0000-0000-0000-0000000057e1'),
  array[true, true, false], 'Rivals and bounties on, blackout off, by default');

select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok($$select public.log_step_story('00000000-0000-0000-0000-0000000057e1', 'race')$$, 'A participant logs the race');
select lives_ok($$select public.log_step_story('00000000-0000-0000-0000-0000000057e1', 'race')$$, 'again the same day: no error');
select public.log_step_story('00000000-0000-0000-0000-0000000057e1', 'replay');
select public.log_step_story('00000000-0000-0000-0000-0000000057e1', 'rival_beaten');
select public.log_step_story('00000000-0000-0000-0000-0000000057e2', 'trail');
select is((select count(*)::int from public.step_story_seen where challenge_id = '00000000-0000-0000-0000-0000000057e1'), 3, 'Once a day per kind');
select throws_ok($$select public.log_step_story('00000000-0000-0000-0000-0000000057e1', 'cheer')$$, 'Unknown kind.', 'Known kinds only');
select throws_ok($$insert into public.step_story_seen (challenge_id, user_id, day, kind) values ('00000000-0000-0000-0000-0000000057e1', auth.uid(), current_date, 'list')$$,
  '42501', null, 'No writing the log directly');
reset role;

select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok($$select public.log_step_story('00000000-0000-0000-0000-0000000057e1', 'race')$$, 'not authorized', 'Participants only');
select is((select count(*)::int from public.step_story_seen), 0, 'and nobody else''s rows show');
select throws_ok($$select public.admin_step_story_overview()$$, 'not authorized', 'Admin only');
reset role;

select tests.sign_in(:'ada');
set local role authenticated;
select is((select jsonb_build_object('people', o -> 'people_7d', 'race', o -> 'race_people_7d', 'replays', o -> 'replays_7d', 'rivals', o -> 'rivals_beaten_7d',
    'trail', o -> 'trail_people_7d', 'blackout', o -> 'live_blackout')
  from public.admin_step_story_overview() o),
  jsonb_build_object('people', 1, 'race', 1, 'replays', 1, 'rivals', 1, 'trail', 1, 'blackout', 0),
  'Admin: people, race, replays, rivals beaten, the trail, live blackouts');
reset role;

select * from finish();
