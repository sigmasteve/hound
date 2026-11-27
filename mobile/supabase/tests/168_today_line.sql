-- 0283: Today's one line's taps count, and show on Admin.
select plan(3);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Boss', true) as boss \gset

select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok($$select public.note_today_tap('line_steps')$$, 'A link on the line');
select public.note_today_tap('line_spoken');
reset role;

select tests.sign_in(:'boss');
set local role authenticated;
select is(public.admin_today_overview() -> 'taps_7d' -> 'line_steps', '{"people": 1, "taps": 1}'::jsonb, 'Admin sees the link''s tap');
select is(public.admin_today_overview() -> 'taps_7d' -> 'line_spoken', '{"people": 1, "taps": 1}'::jsonb, 'And the hound saying it');
reset role;

select * from finish();
