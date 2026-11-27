-- 0278: Customize Today's switches, Your day's taps and Admin's numbers.
select plan(12);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bo') as bo \gset
select tests.new_user('Boss', true) as boss \gset

select tests.sign_in(:'ann');
set local role authenticated;
select is(public.my_today_prefs(), '{}'::jsonb, 'Nothing saved: every extra is off');
select is(
  public.set_today_prefs('{"week": true, "holiday": false, "rank": "yes", "nope": true}'::jsonb),
  '{"week": true, "holiday": false}'::jsonb,
  'Unknown keys and non-booleans are dropped');
select is(public.my_today_prefs(), '{"week": true, "holiday": false}'::jsonb, 'Saved for the account');
select is(public.set_today_prefs('{"journey": true}'::jsonb), '{"journey": true}'::jsonb, 'A save replaces the set');
select is(public.set_today_prefs('[1,2]'::jsonb), '{}'::jsonb, 'Not an object: nothing on');
select public.set_today_prefs('{"journey": true, "hound_top": true}'::jsonb);
select lives_ok($$select public.note_today_tap('steps')$$, 'A Your day tap');
select public.note_today_tap('steps');
select public.note_today_tap('move');
select lives_ok($$select public.note_today_tap('something else')$$, 'Unknown taps are ignored');
select throws_ok($$select public.admin_today_overview()$$, 'not authorized', 'Admin only');
reset role;

select tests.sign_in(:'bo');
set local role authenticated;
select is(public.my_today_prefs(), '{}'::jsonb, 'Each person''s own');
select public.set_today_prefs('{"holiday": false}'::jsonb);
select public.note_today_tap('customize');
reset role;

select tests.sign_in(:'boss');
set local role authenticated;
select public.admin_today_overview() as o \gset
select is((:'o'::jsonb ->> 'customized')::int, 1, 'One has an extra on (turning one off doesn''t count)');
select is(:'o'::jsonb -> 'extras' -> 'journey', '1'::jsonb, 'Journey on for one');
select is(:'o'::jsonb -> 'taps_7d' -> 'steps', '{"people": 1, "taps": 2}'::jsonb, 'Steps tapped twice by one');
reset role;

select * from finish();
