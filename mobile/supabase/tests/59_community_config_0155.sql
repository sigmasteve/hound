-- 0155: Admin → Community challenges' switches and limits save, with
-- pg-safeupdate loaded (as it is for the app's API connections).
select plan(4);

select tests.new_user('Ann', true) as ann \gset
select tests.new_user('Bob') as bob \gset

select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok($q$select public.admin_set_community_config('{"age_gate": false}')$q$, 'Only an admin can do that.',
  'Only an admin can change the settings');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok($q$select public.admin_set_community_config('{"age_gate": false}')$q$, 'Turning off the 13+ check saves');
select public.admin_set_community_config('{"max_live": 4}');
reset role;
select is((select age_gate from public.community_config), false, 'and it''s off');
select is((select max_live from public.community_config), 4, 'and a limit saves, leaving the rest');

select * from finish();
