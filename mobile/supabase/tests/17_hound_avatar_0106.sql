-- 0106: your hound as your avatar, kept in step with the hound, and off
-- again; a Locker icon is left alone.
select plan(5);

select tests.new_user('Ann') as ann \gset
select (now() at time zone 'utc')::date as today \gset

select tests.sign_in(:'ann');
set local role authenticated;
select is(public.use_hound_avatar(:'today', true), 'hound:.floppy.wavy.none...', 'The default hound as an avatar');
select public.set_kennel_look(:'today', 'perky', null, 'spots');
reset role;
select is((select equipped_icon_id from public.profiles where id = :'ann'), 'hound:.perky.wavy.spots...',
  'Changing the hound changes the avatar');

select tests.sign_in(:'ann');
set local role authenticated;
select is(public.use_hound_avatar(:'today', false), null, 'Turning it off');
reset role;
select is((select equipped_icon_id from public.profiles where id = :'ann'), null, 'goes back to initials');

update public.profiles set equipped_icon_id = 'icon_paw' where id = :'ann';
select tests.sign_in(:'ann');
set local role authenticated;
select public.set_kennel_look(:'today', 'short', null, null);
select public.use_hound_avatar(:'today', false);
reset role;
select is((select equipped_icon_id from public.profiles where id = :'ann'), 'icon_paw', 'A Locker icon is left alone');

select * from finish();
