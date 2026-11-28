-- 0287: the Goals card as a Customize Today extra, its taps, and Admin.
select plan(5);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Boss', true) as boss \gset

select tests.sign_in(:'ann');
set local role authenticated;
select is(public.set_today_prefs('{"goals_card": true, "fasting_card": true}'::jsonb) -> 'goals_card', 'true'::jsonb, 'The Goals card can be switched on');
select lives_ok($$select public.note_today_tap('goals_card_seen')$$, 'Showing it counts');
select public.note_today_tap('goals_card');
reset role;

select tests.sign_in(:'boss');
set local role authenticated;
select is((public.admin_today_overview() -> 'extras' ->> 'goals_card')::int, 1, 'Admin counts who has it on');
select is(public.admin_today_overview() -> 'taps_7d' -> 'goals_card', '{"people": 1, "taps": 1}'::jsonb, 'And taps on it');
select is((public.admin_today_overview() ->> 'customized')::int, 1, 'It''s an extra');
reset role;

select * from finish();
