-- 0283: Today's one line's taps count, its switch, and Admin.
select plan(6);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Boss', true) as boss \gset

select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok($$select public.note_today_tap('line_steps')$$, 'A link on the line');
select public.note_today_tap('line_spoken');
select is(public.set_today_prefs('{"one_line": false}'::jsonb), '{"one_line": false}'::jsonb, 'The one line can be switched off');
reset role;

select tests.new_user('Bo') as bo \gset
select tests.sign_in(:'bo');
set local role authenticated;
select public.set_today_prefs('{"one_line": true, "week": false}'::jsonb);
reset role;

select tests.sign_in(:'boss');
set local role authenticated;
select is(public.admin_today_overview() -> 'taps_7d' -> 'line_steps', '{"people": 1, "taps": 1}'::jsonb, 'Admin sees the link''s tap');
select is(public.admin_today_overview() -> 'taps_7d' -> 'line_spoken', '{"people": 1, "taps": 1}'::jsonb, 'And the hound saying it');
select is((public.admin_today_overview() ->> 'line_off')::int, 1, 'One turned the line off');
select is((public.admin_today_overview() ->> 'customized')::int, 0, 'Leaving the line on isn''t an extra');
reset role;

select * from finish();
