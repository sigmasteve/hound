-- 0163: each person reports where their Android app came from, on their
-- own row only.
select plan(4);

select tests.new_user('Sis') as sis \gset
select tests.new_user('Bo') as bo \gset

select tests.sign_in(:'sis');
set local role authenticated;
select lives_ok(format($$ update public.profiles set app_install_source = 'website', app_install_referrer = 'utm_source=(not%%20set)' where id = %L $$, :'sis'),
  'A member reports their own install source');
select throws_ok(format($$ update public.profiles set app_install_source = 'sideways' where id = %L $$, :'sis'), '23514', null,
  'Only play or website');
update public.profiles set app_install_source = 'play' where id = :'bo';
reset role;
select is((select app_install_source from public.profiles where id = :'sis'), 'website', 'It''s saved');
select ok((select app_install_source is null from public.profiles where id = :'bo'), 'Nobody else''s row changes');

select * from finish();
