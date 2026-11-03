-- 0164: the install source columns can be read, as App versions does.
select plan(2);

select tests.new_user('Ann', true) as ann \gset
select tests.new_user('Sis') as sis \gset
update public.profiles set app_install_source = 'website' where id = :'sis';

select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok($$ select id, name, app_platform, app_version, app_build, app_install_source, app_install_referrer from public.profiles $$,
  'The App versions read works');
select is((select app_install_source from public.profiles where id = :'sis'), 'website', 'and shows where it came from');
reset role;

select * from finish();
