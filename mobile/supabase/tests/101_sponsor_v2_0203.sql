-- 0203: sponsor placements — setting them, their checks, views and taps
-- by placement, the sponsor report and Admin's overview.
select plan(23);

select tests.new_user('Ada', true) as ada \gset
select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset

insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, is_global, join_closes_at)
values
  ('00000000-0000-0000-0000-0000000005a1', 'Sponsored Steps', 'steps', :'ada', 7, now() - interval '1 day', now() + interval '6 days', true, now() + interval '2 days'),
  ('00000000-0000-0000-0000-0000000005b1', 'Friends', 'steps', :'ann', 7, now() - interval '1 day', now() + interval '6 days', false, null);
insert into public.challenge_participants (challenge_id, user_id) values
  ('00000000-0000-0000-0000-0000000005a1', :'ann'), ('00000000-0000-0000-0000-0000000005a1', :'bob');

-- ── Setting it ──

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($q$select public.set_challenge_sponsor_v2('00000000-0000-0000-0000-0000000005a1', '{"name": "Acme"}'::jsonb)$q$,
  'not authorized', 'Admins only');
reset role;

select tests.sign_in(:'ada');
set local role authenticated;
select throws_ok($q$select public.set_challenge_sponsor_v2('00000000-0000-0000-0000-0000000005b1', '{"name": "Acme"}'::jsonb)$q$,
  'Only a global challenge can have a sponsor.', 'Global only');
select throws_ok($q$select public.set_challenge_sponsor_v2('00000000-0000-0000-0000-0000000005a1', '{"name": "Acme", "logo_url": "http://x.example/a.png"}'::jsonb)$q$,
  'The logo must be an https:// link.', 'The logo is https');
select throws_ok($q$select public.set_challenge_sponsor_v2('00000000-0000-0000-0000-0000000005a1', '{"name": "Acme", "color": "orange"}'::jsonb)$q$,
  'The sponsor''s colour is a hex colour like #F08A24.', 'A hex colour');
select throws_ok($q$select public.set_challenge_sponsor_v2('00000000-0000-0000-0000-0000000005a1', '{"name": "Acme", "hole": 7}'::jsonb)$q$,
  'A sponsored hole is 1 to 9, on a Golf challenge.', 'A sponsored hole is for Golf');
select throws_ok($q$select public.set_challenge_sponsor_v2('00000000-0000-0000-0000-0000000005a1', '{"name": "Acme", "finish_label": "x", "finish_message": "This message is far too long for the finish card because it keeps going and going and going well past the hundred and twenty mark."}'::jsonb)$q$,
  'Keep the finish message to 120 characters.', 'The finish message is short');
select lives_ok($q$select public.set_challenge_sponsor_v2('00000000-0000-0000-0000-0000000005a1', jsonb_build_object(
  'name', 'Acme Running Co.', 'message', 'Every mile tells a story.', 'url', 'https://acme.example/open',
  'logo_url', 'https://cdn.example/acme.png', 'color', '#F08A24', 'presented', true, 'boards', true,
  'finish_message', 'Your feet earned a new pair.', 'finish_label', 'See Acme''s trail shoes',
  'prizes', true, 'prize_note', 'Plus a trail cap for the winner.'))$q$, 'An admin sets the whole sponsor');
reset role;

select is((select jsonb_build_array(sponsor_name, sponsor_color, sponsor_presented, sponsor_boards, sponsor_prizes, sponsor_finish_label)
           from public.challenges where id = '00000000-0000-0000-0000-0000000005a1'),
  '["Acme Running Co.", "#F08A24", true, false, true, "See Acme''s trail shoes"]'::jsonb,
  'Saved; boards on the course are Golf only, so off for a Step Race');

-- ── Views and taps ──

select tests.sign_in(:'ann');
set local role authenticated;
select public.record_sponsor_views('00000000-0000-0000-0000-0000000005a1', array['today', 'presented', 'nonsense']);
select public.record_sponsor_views('00000000-0000-0000-0000-0000000005a1', array['today']);
select public.record_sponsor_click('00000000-0000-0000-0000-0000000005a1', 'presented');
select public.record_sponsor_click('00000000-0000-0000-0000-0000000005a1', 'presented');
select lives_ok($q$select public.record_sponsor_views('00000000-0000-0000-0000-0000000005b1', array['today'])$q$,
  'A challenge without a sponsor counts nothing, quietly');
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
select public.record_sponsor_views('00000000-0000-0000-0000-0000000005a1', array['finish']);
select public.record_sponsor_click('00000000-0000-0000-0000-0000000005a1');
reset role;

select is((select sum(views)::int from public.sponsor_views where challenge_id = '00000000-0000-0000-0000-0000000005a1'), 4,
  'Four views: Ann''s Today twice and presented once, Bob''s finish (the unknown placement ignored)');
select is((select count(*)::int from public.sponsor_views where challenge_id = '00000000-0000-0000-0000-0000000005b1'), 0,
  'Nothing for an unsponsored challenge');
select is((select array_agg(coalesce(placement, '-') order by placement nulls last) from public.sponsor_link_clicks where challenge_id = '00000000-0000-0000-0000-0000000005a1'),
  array['presented', '-'], 'Taps: a double tap counts once; one with no placement (an older app) still counts');

-- ── The report ──

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($q$select public.admin_sponsor_report('00000000-0000-0000-0000-0000000005a1')$q$, 'not authorized', 'The report is admins only');
reset role;

select tests.sign_in(:'ada');
set local role authenticated;
select public.admin_sponsor_report('00000000-0000-0000-0000-0000000005a1') as r \gset
select public.admin_sponsor_overview() as o \gset
reset role;
select is((:'r'::jsonb ->> 'players')::int, 2, 'Two players');
select is((:'r'::jsonb ->> 'reached')::int, 2, 'Both saw the sponsor');
select is((:'r'::jsonb ->> 'views')::int, 4, 'Four views');
select is((:'r'::jsonb ->> 'taps')::int, 2, 'Two taps');
select is((:'r'::jsonb ->> 'tap_rate')::numeric, 0.5, 'A tap for every two views');
select is((select x from jsonb_array_elements(:'r'::jsonb -> 'placements') x where x ->> 'placement' = 'today'),
  '{"placement": "today", "views": 2, "viewers": 1, "taps": 0}'::jsonb, 'By placement');
select is(:'r'::jsonb -> 'hole', 'null'::jsonb, 'No hole line on a Step Race');
select is((:'o'::jsonb ->> 'sponsored_live')::int >= 1, true, 'The overview counts it live');
select ok(exists (select 1 from jsonb_array_elements(:'o'::jsonb -> 'challenges') x where x ->> 'challenge_id' = '00000000-0000-0000-0000-0000000005a1'),
  'And lists it');

-- ── Taking it off ──

select tests.sign_in(:'ada');
set local role authenticated;
select public.set_challenge_sponsor('00000000-0000-0000-0000-0000000005a1', '', null, null);
reset role;
select is((select jsonb_build_array(sponsor_name, sponsor_logo_url, sponsor_presented, sponsor_prizes, sponsor_prize_note)
           from public.challenges where id = '00000000-0000-0000-0000-0000000005a1'),
  '[null, null, false, false, null]'::jsonb, 'A blank name takes every placement off, even through 0111''s function');

select * from finish();
