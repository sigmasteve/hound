-- 0263: up to 4 clubs each; admins have no limit.
select plan(4);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Boss', true) as boss \gset
update public.profiles set username = lower(name) || left(id::text, 4), xp_total = 5000, created_at = now() - interval '30 days' where id in (:'ann', :'boss');
insert into public.clubs (code, name, sport, is_public, created_by)
  select 'L' || u.n || left(p.id::text, 4), 'Club ' || u.n, 'running', true, p.id
  from public.profiles p cross join generate_series(1, 3) u(n) where p.id in (:'ann', :'boss');

select is((select max_owned from public.club_config), 4, 'The limit is 4');
select is(public.club_create_problem(:'ann'), null, 'Ann runs 3 and can start a 4th');
insert into public.clubs (code, name, sport, is_public, created_by) values ('L4ANN0', 'Club 4', 'running', true, :'ann'), ('L4BOS0', 'Club 4', 'running', true, :'boss');
select is(public.club_create_problem(:'ann'), 'You can run up to 4 clubs.', 'At 4 she can''t start a 5th');
select is(public.club_create_problem(:'boss'), null, 'An admin has no limit');

select * from finish();
