-- 0119: people set their own name, and only their own.
select plan(6);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset

select tests.sign_in(:'ann');
set local role authenticated;
select is((select initials from public.set_my_name('  Ann   Marie Smith ')), 'AM', 'Initials from the first two words');
select is((select name from public.profiles where id = auth.uid()), 'Ann Marie Smith', 'Spaces are tidied');
select throws_ok('select public.set_my_name(''-'')', 'Your name needs 1 to 40 characters.', 'A dash isn''t a name');
select throws_ok('select public.set_my_name(''   '')', 'Your name needs 1 to 40 characters.', 'Blank isn''t a name');
reset role;

select is((select name from public.profiles where id = :'bob'), 'Bob', 'Nobody else''s name changes');
select ok(not has_function_privilege('anon', 'public.set_my_name(text)', 'EXECUTE'), 'Signed-out visitors can''t call it');

select * from finish();
