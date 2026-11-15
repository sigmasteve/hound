-- 0209: H-O-R-S-E, call your shot. The window and its pieces (calls, the
-- chair, steadiness, the floor), descriptions, set / match / rebuttal to
-- the end, a missed set passing the turn, timeouts (a match is a letter, a
-- set passes), tries from steps (2,000), unlocks by best day and needed to
-- match, calls checked against the scene, highlights to Talk at 4-5 stars
-- only, the stakes (once, Bones floored at 0, none on a tie), hands-off
-- games as before, the view, and Admin.
select plan(70);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Ada', true) as ada \gset
update public.profiles set time_zone = 'America/New_York' where id in (:'ann', :'bob');
select public.soccer_today(:'ann') as today \gset

-- ── The pieces ──

select is(public.horse_window('{"kind":"floor","u":-0.9,"v":0.06}', '{}', false, 12000), 0.2618, 'Left corner, no calls, 12,000 steps');
select is(public.horse_window('{"kind":"floor","u":-0.9,"v":0.06}', '{board,net}', false, 12000), 0.1309, 'Off the scoreboard halves it (nothing but net doesn''t narrow it)');
select is(public.horse_window('{"kind":"floor","u":-0.9,"v":0.06}', '{}', true, 12000), 0.2225, 'Over the chair: x0.85');
select is(public.horse_window('{"kind":"bench"}', '{}', false, 6000), 0.0941, 'Up on the bench: x0.85, at steadiness 1.0');
select is(public.horse_window('{"kind":"roof"}', '{billboard,net}', false, 9400), 0.0553, 'The rooftop, off the billboard, at 9,400 steps');
select is(public.horse_window('{"kind":"rafters"}', '{floor,board,glass,back,net}', false, 0), 0.0250, 'Never below 0.025');
select is(public.horse_window('{"kind":"floor","u":0,"v":1}', '{}', false, 12000), 0.0750, 'Half court: the floor of 0.06, then steadiness');
select is(public.horse_stars(0.2618), 2, 'Stars: 2');
select is(public.horse_stars(0.0941), 4, 'Stars: 4');
select is(public.horse_stars(0.0553), 5, 'Stars: 5');
select ok(public.horse_over_chair('{"kind":"floor","u":0,"v":0.66}', '{"u":-0.06,"v":0.30}'), 'From the top of the key the line passes the chair');
select ok(not public.horse_over_chair('{"kind":"floor","u":-0.9,"v":0.06}', '{"u":-0.06,"v":0.30}'), 'From the corner it doesn''t');
select ok(not public.horse_over_chair('{"kind":"lot"}', '{"u":-0.06,"v":0.30}'), 'Nor from outside');
select is(public.horse_describe('{"kind":"floor","u":0,"v":0.66}', '{floor,board,glass,net}', true),
  'From the top of the key, over the chair, off the floor, off the scoreboard, off the glass. Nothing but net.', 'The chain, in words');
select is(public.horse_describe('{"kind":"roof"}', '{billboard,net}', false),
  'Rooftop across the street, off the billboard, through the gym window. Nothing but net.', 'Outside, in words');
select is(public.horse_describe('{"kind":"bench"}', '{back}', false), 'Up on the bench, behind the back.', 'The bench, in words');
select is(public.horse_spot_name('{"kind":"floor","u":0.24,"v":0.40}'), 'Right elbow', 'A spot''s name: the elbow');
select is(public.horse_spot_name('{"kind":"floor","u":-0.62,"v":0.48}'), 'Left wing', 'The wing');
select is(public.horse_spot_name('{"kind":"floor","u":0,"v":0.97}'), 'Half court', 'Half court');
select is(public.horse_calls('{"kind":"floor","u":0,"v":0.5}', '{net,glass,floor,glass}'), '{floor,glass,net}'::text[], 'Calls are put in their order, once each');

-- ── Games ──

insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-00000000e901', 'Horse live', 'horse', :'ann', 7, now() - interval '2 days', now() + interval '5 days', :'today'::date - 2),
  ('00000000-0000-0000-0000-00000000e902', 'Horse tie', 'horse', :'ann', 7, now() - interval '8 days', now() - interval '1 hour', :'today'::date - 8),
  ('00000000-0000-0000-0000-00000000e903', 'Horse old', 'horse', :'ann', 7, now() - interval '2 days', now() + interval '5 days', :'today'::date - 2),
  ('00000000-0000-0000-0000-00000000e904', 'Horse tired', 'horse', :'bob', 7, now() - interval '2 days', now() + interval '5 days', :'today'::date - 2);
insert into public.challenge_participants (challenge_id, user_id) values
  ('00000000-0000-0000-0000-00000000e901', :'ann'), ('00000000-0000-0000-0000-00000000e902', :'ann'),
  ('00000000-0000-0000-0000-00000000e903', :'ann'), ('00000000-0000-0000-0000-00000000e904', :'bob');

select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok($$select public.horse_setup('00000000-0000-0000-0000-00000000e901', 'HORSE', p_hands_on => true, p_stakes => 'pb_pupcake')$$,
  'horse_setup takes hands_on and the stakes');
select throws_ok($$select public.horse_setup('00000000-0000-0000-0000-00000000e902', 'HORSE', true, 'caviar')$$,
  'P0001', 'Pick a treat for the stakes.', 'The stakes must be a treat');
select public.horse_setup('00000000-0000-0000-0000-00000000e902', 'HORSE', true, 'pb_pupcake');
select lives_ok($$select public.horse_setup('00000000-0000-0000-0000-00000000e903')$$, 'The old call still works');
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
select public.horse_setup('00000000-0000-0000-0000-00000000e904', 'HORSE', true, null);
reset role;
select is((select hands_on::text || coalesce(stakes, '-') from public.horse_games where challenge_id = '00000000-0000-0000-0000-00000000e903'), 'false-', 'Old calls make a hands-off game with no stakes');

insert into public.challenge_participants (challenge_id, user_id) values
  ('00000000-0000-0000-0000-00000000e901', :'bob'), ('00000000-0000-0000-0000-00000000e902', :'bob'),
  ('00000000-0000-0000-0000-00000000e903', :'bob'), ('00000000-0000-0000-0000-00000000e904', :'ann');
insert into public.progress_snapshots (challenge_id, user_id, day, steps) values
  ('00000000-0000-0000-0000-00000000e901', :'ann', :'today'::date - 1, 11200),
  ('00000000-0000-0000-0000-00000000e901', :'ann', :'today', 9400),
  ('00000000-0000-0000-0000-00000000e901', :'bob', :'today', 9000),
  ('00000000-0000-0000-0000-00000000e904', :'bob', :'today', 1500);
update public.profiles set bones_balance = 10 where id = :'bob';

-- ── Ann's turn to set ──

select tests.sign_in(:'ann');
set local role authenticated;
select public.horse_live('00000000-0000-0000-0000-00000000e901') as live \gset
select is(:'live'::jsonb #>> '{turn,user}', :'ann', 'Both in: the creator sets first');
select is(:'live'::jsonb #>> '{turn,kind}', 'set', 'A set');
select is((:'live'::jsonb ->> 'tries')::int, 4, 'Tries: one per 2,000 steps (9,400 -> 4)');
select is((:'live'::jsonb ->> 'next_try_at')::int, 10000, 'The next at 10,000');
select is((:'live'::jsonb ->> 'best_day')::int, 11200, 'Best day so far: yesterday''s 11,200');
select is((select string_agg(u ->> 'kind' || ':' || (u ->> 'unlocked'), ',') from jsonb_array_elements(:'live'::jsonb -> 'unlocks') u),
  'stands:true,rafters:true,lot:true,roof:false', 'The stands, rafters and lot are unlocked by that day; not the roof');
select is((:'live'::jsonb -> 'stakes' ->> 'name'), 'Peanut butter pupcake', 'The stakes');
select ok((:'live'::jsonb ->> 'can_shoot')::boolean, 'Ann can shoot');
select throws_ok($$select public.horse_preview('00000000-0000-0000-0000-00000000e901', '{"kind":"lot"}', '{board}')$$,
  'P0001', '"Off the scoreboard" is for shots inside the gym.', 'Inside calls aren''t for outside');
select throws_ok($$select public.horse_preview('00000000-0000-0000-0000-00000000e901', '{"kind":"floor","u":0,"v":0.5}', '{billboard}')$$,
  'P0001', '"Off the billboard" is for shots from outside.', 'Nor the billboard inside');
select throws_ok($$select public.horse_preview('00000000-0000-0000-0000-00000000e901', '{"kind":"floor","u":2,"v":0.5}', '{}')$$,
  'P0001', 'Pick a spot on the court.', 'A spot off the court');
select is((public.horse_preview('00000000-0000-0000-0000-00000000e901', '{"kind":"floor","u":-0.9,"v":0.06}', '{}') ->> 'description'),
  'From the left corner.', 'Preview: the description');
select throws_ok($$select public.horse_shoot('00000000-0000-0000-0000-00000000e901', '{"kind":"roof"}', '{}', 0)$$,
  'P0001', 'A 15K day unlocks the rooftop across the street for the rest of the game.', 'The roof is locked');

-- Ann sets the left corner and makes it: 2 stars, no highlight.
select public.horse_shoot('00000000-0000-0000-0000-00000000e901', '{"kind":"floor","u":-0.9,"v":0.06}', '{}', 0) as s1 \gset
select ok((:'s1'::jsonb ->> 'made')::boolean, 'Made');
select is((:'s1'::jsonb ->> 'stars')::int, 2, '2 stars');
select ok(not (:'s1'::jsonb ->> 'highlight')::boolean, 'Not a highlight');
select is(:'s1'::jsonb #>> '{turn,user}', :'bob', 'The turn goes to Bob');
select is(:'s1'::jsonb #>> '{turn,kind}', 'match', 'To match it');
select is((:'s1'::jsonb ->> 'tries')::int, 3, 'A try used');
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok($$select public.horse_shoot('00000000-0000-0000-0000-00000000e904', '{"kind":"floor","u":0,"v":0.5}', '{}', 0)$$,
  'P0001', 'No tries ready: the next comes at 2,000 steps.', 'No tries under 2,000 steps');
select is(public.horse_live('00000000-0000-0000-0000-00000000e901') #>> '{pending,description}', 'From the left corner.', 'Bob sees the shot to match');
-- Bob misses: the H.
select public.horse_shoot('00000000-0000-0000-0000-00000000e901', null, null, 0.49) as s2 \gset
select ok(not (:'s2'::jsonb ->> 'made')::boolean, 'Bob misses it');
select is(:'s2'::jsonb ->> 'letter_to', :'bob', 'And takes a letter');
select is(:'s2'::jsonb ->> 'message', 'You take the H. Ann sets the next shot.', 'In words');
reset role;
select is((select (letters ->> :'bob')::int from public.horse_games where challenge_id = '00000000-0000-0000-0000-00000000e901'), 1, 'Bob has the H');

-- Ann: the parking lot, off the billboard, nothing but net. A highlight.
select tests.sign_in(:'ann');
set local role authenticated;
select public.horse_shoot('00000000-0000-0000-0000-00000000e901', '{"kind":"lot"}', '{net,billboard}', 0) as s3 \gset
select ok((:'s3'::jsonb ->> 'made')::boolean and (:'s3'::jsonb ->> 'highlight')::boolean, 'Made, a highlight');
select is((:'s3'::jsonb ->> 'stars')::int, 5, '5 stars');
reset role;
select is((select string_agg(body, '|') from public.challenge_messages where challenge_id = '00000000-0000-0000-0000-00000000e901'),
  '🏀 Highlight in H-O-R-S-E: Parking lot, off the billboard, through the gym window. Nothing but net. ★★★★★', 'Posted to Talk, once (the 2-star make wasn''t)');

-- Bob hasn't had a 10K day: he can't even try it.
select tests.sign_in(:'bob');
set local role authenticated;
select public.horse_live('00000000-0000-0000-0000-00000000e901') as live \gset
select ok(not (:'live'::jsonb ->> 'can_shoot')::boolean, 'Bob can''t shoot it');
select is(:'live'::jsonb ->> 'reason', 'A 10K day unlocks the parking lot for the rest of the game.', 'The lot needs a 10K day');
select throws_ok($$select public.horse_shoot('00000000-0000-0000-0000-00000000e901', null, null, 0)$$,
  'P0001', 'A 10K day unlocks the parking lot for the rest of the game.', 'And the shot says so');
reset role;

-- A day goes by: a match not tried is a letter.
update public.horse_games set turn_started_at = now() - interval '25 hours' where challenge_id = '00000000-0000-0000-0000-00000000e901';
select tests.sign_in(:'bob');
set local role authenticated;
select public.horse_live('00000000-0000-0000-0000-00000000e901') as live \gset
select is((:'live'::jsonb -> 'letters' ->> :'bob')::int, 2, 'Out of time to match: the O');
select is(:'live'::jsonb #>> '{turn,user}', :'ann', 'Ann sets again');
select is(:'live'::jsonb -> 'last' ->> 'timeout', 'true', 'The last shot is the timeout');
reset role;

-- Ann misses her own call: no letter, Bob sets.
select tests.sign_in(:'ann');
set local role authenticated;
select public.horse_shoot('00000000-0000-0000-0000-00000000e901', '{"kind":"floor","u":-0.9,"v":0.06}', '{}', 0.45) as s4 \gset
select is(:'s4'::jsonb ->> 'message', 'Missed your own call. No letter, but the turn passes: Bob sets the next shot.', 'A missed call passes the turn');
select is(:'s4'::jsonb #>> '{turn,user}', :'bob', 'To Bob');
select is(:'s4'::jsonb #>> '{turn,kind}', 'set', 'To set');
select throws_ok($$select public.horse_shoot('00000000-0000-0000-0000-00000000e901', '{"kind":"floor","u":0,"v":0.5}', '{}', 0)$$,
  'P0001', 'Bob''s turn.', 'Not Ann''s turn');
reset role;

-- Bob doesn't set in time: the turn passes.
update public.horse_games set turn_started_at = now() - interval '25 hours' where challenge_id = '00000000-0000-0000-0000-00000000e901';
select tests.sign_in(:'ann');
set local role authenticated;
select public.horse_live('00000000-0000-0000-0000-00000000e901') as live \gset
select is(:'live'::jsonb #>> '{turn,user}', :'ann', 'A set not taken passes to Ann');
select is((:'live'::jsonb -> 'letters' ->> :'bob')::int, 2, 'And costs no letter');
reset role;

-- Bob on his last letter: the rebuttal, then the E.
update public.horse_games set letters = letters || jsonb_build_object(:'bob'::text, 4) where challenge_id = '00000000-0000-0000-0000-00000000e901';
select tests.sign_in(:'ann');
set local role authenticated;
select public.horse_shoot('00000000-0000-0000-0000-00000000e901', '{"kind":"floor","u":-0.9,"v":0.06}', '{}', 0) as s5 \gset
select is((:'s5'::jsonb #>> '{turn,shots_left}')::int, 2, 'On his last letter Bob gets two tries');
reset role;
select tests.sign_in(:'bob');
set local role authenticated;
select public.horse_shoot('00000000-0000-0000-0000-00000000e901', null, null, 0.49) as s6 \gset
select is(:'s6'::jsonb ->> 'message', 'Missed, but it''s your last letter, so you get one more try (the rebuttal).', 'The rebuttal');
select is(:'s6'::jsonb #>> '{turn,user}', :'bob', 'Still Bob''s turn');
select public.horse_shoot('00000000-0000-0000-0000-00000000e901', null, null, 0.49) as s7 \gset
select ok((:'s7'::jsonb ->> 'game_over')::boolean, 'H-O-R-S-E: over');
select is(:'s7'::jsonb ->> 'winner', :'ann', 'Ann wins');
select is(:'s7'::jsonb ->> 'message', 'H-O-R-S-E. Ann wins, and you owe Ann''s hound a Peanut butter pupcake.', 'In words, with the stakes');
reset role;

select is((select count(*)::int from public.hound_treats t where t.user_id = :'ann' and t.made_by = :'bob' and t.recipe_id = 'pb_pupcake' and t.note = 'Lost at H-O-R-S-E'),
  1, 'Bob baked Ann''s hound the pupcake');
select is((select bones_balance from public.profiles where id = :'bob'), 0, 'Its 25 Bones, down to 0 (he had 10)');
select tests.sign_in(:'ann');
set local role authenticated;
select is(public.horse_live('00000000-0000-0000-0000-00000000e901') ->> 'reason', 'This game is over.', 'Over');
reset role;
select is((select count(*)::int from public.hound_treats t where t.user_id = :'ann'), 1, 'The stakes are paid once');

-- A tie at the end pays nothing.
select tests.sign_in(:'ann');
set local role authenticated;
select public.horse_live('00000000-0000-0000-0000-00000000e902') as live \gset
reset role;
select is((select status || ':' || coalesce(winner::text, 'tie') || ':' || (stakes_paid_at is null)::text from public.horse_games where challenge_id = '00000000-0000-0000-0000-00000000e902'),
  'final:tie:true', 'Level at the end: a tie, no stakes');

-- Hands-off: as before.
select tests.sign_in(:'ann');
set local role authenticated;
select is(public.horse_live('00000000-0000-0000-0000-00000000e903') ->> 'reason', 'This game plays itself.', 'A hands-off game plays itself');
select throws_ok($$select public.horse_shoot('00000000-0000-0000-0000-00000000e903', '{"kind":"floor","u":0,"v":0.5}', '{}', 0)$$,
  'P0001', 'This game plays itself.', 'No shots in it');
select is(public.horse_view('00000000-0000-0000-0000-00000000e903') -> 'live', 'null'::jsonb, 'Its view has no live part');
select public.horse_view('00000000-0000-0000-0000-00000000e901') as v \gset
select ok((:'v'::jsonb ->> 'hands_on')::boolean and :'v'::jsonb -> 'live' is not null, 'The hands-on view has hands_on and live');
select is(jsonb_array_length(:'v'::jsonb -> 'recent'), 9, 'And the recent shots, timeouts included');
select throws_ok($$select public.admin_hoops_overview()$$, 'P0001', 'not authorized', 'Admin only');
reset role;

select tests.sign_in(:'ada');
set local role authenticated;
select public.admin_hoops_overview() -> 'horse_hands_on' as a \gset
select is(:'a'::jsonb, jsonb_build_object('games_hands_on', 1, 'people_7d', 2, 'shots_7d', 7, 'made_rate_7d', 0.429,
  'highlights_7d', 1, 'far_shots_7d', 1, 'stakes_paid_all', 1, 'timeouts_7d', 2), 'Admin: H-O-R-S-E by hand');
reset role;

select * from finish();
