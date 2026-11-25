-- 0268: an owner can delete their club; nobody else can.
select plan(6);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset
update public.profiles set username = lower(name) || left(id::text, 4) where id in (:'ann', :'bob', :'cat');
insert into public.clubs (code, name, sport, is_public, created_by) values ('DEL' || left(:'ann', 4), 'Test Pack', 'walking', false, :'ann')
  returning id as club \gset
insert into public.club_members (club_id, user_id, role) values (:'club', :'ann', 'owner'), (:'club', :'bob', 'organizer'), (:'club', :'cat', 'member')
  on conflict (club_id, user_id) do update set role = excluded.role;

select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok(format('select public.delete_club(%L)', :'club'), 'Only the club''s owner can delete it.', 'An organizer can''t delete the club');
reset role;
select tests.sign_in(:'cat');
set local role authenticated;
select throws_ok(format('select public.delete_club(%L)', :'club'), 'Only the club''s owner can delete it.', 'Nor can a member');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok(format('select public.delete_club(%L)', :'club'), 'The owner deletes it');
reset role;
select is((select removed_reason from public.clubs where id = :'club'), 'deleted by owner', 'It''s taken down, marked as the owner''s doing');
select ok((select removed_at is not null from public.clubs where id = :'club'), 'and closed');
select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok(format('select public.delete_club(%L)', :'club'), 'That club isn''t open.', 'Deleting it again says so');
reset role;

select * from finish();
