-- 0188: a minimum app version, read by everyone signed in, set by admins.
select plan(6);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Ada', true) as ada \gset

select tests.sign_in(:'ann');
set local role authenticated;
select is((select min_version from public.app_version_gate), null, 'Nobody is blocked to start with');
select throws_ok($$select public.admin_set_min_app_version('0.12.0')$$, 'not authorized', 'Only admins set it');
select throws_ok($$update public.app_version_gate set min_version = '9.9.9' where id$$, '42501', null, 'and nobody writes it directly');
reset role;

select tests.sign_in(:'ada');
set local role authenticated;
select throws_ok($$select public.admin_set_min_app_version('twelve')$$, 'A version looks like 0.12.0.', 'It has to look like a version');
select public.admin_set_min_app_version('0.12.0');
select is((select min_version from public.app_version_gate), '0.12.0', 'Admin sets 0.12.0');
select public.admin_set_min_app_version('');
select is((select min_version from public.app_version_gate), null, 'and clears it');
reset role;

select * from finish();
