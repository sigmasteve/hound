-- 0240: muting Needs you. A mute logged, its length checked, one at a
-- time, an early unmute, nobody else's rows, and Admin.
select plan(9);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Ada', true) as ada \gset

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select public.log_needs_you_mute(6, now() + interval '6 hours', 3)$$,
  'Mute for 2, 4 or 12 hours, or until tomorrow morning.', 'Only the lengths offered');
select throws_ok($$select public.log_needs_you_mute(12, now() + interval '3 days', 3)$$, 'Invalid mute.', 'Never more than a day');
select ok(public.log_needs_you_mute(4, now() + interval '4 hours', 3) > 0, 'Muted for 4 hours');
select ok(public.log_needs_you_mute(12, now() + interval '12 hours', 2) > 0, 'then for half a day');
select is((select count(*)::int from public.needs_you_mutes where user_id = :'ann' and unmuted_at is null), 1, 'One mute at a time: the new one ends the last');
select public.log_needs_you_unmute();
select is((select count(*)::int from public.needs_you_mutes where user_id = :'ann' and unmuted_at is null), 0, 'Unmuted early');
reset role;

select tests.sign_in(:'bob');
set local role authenticated;
select is((select count(*)::int from public.needs_you_mutes), 0, 'Bob sees none of Ann''s');
select throws_ok($$select public.admin_needs_you_overview()$$, 'not authorized', 'Admins only');
reset role;

select tests.sign_in(:'ada');
set local role authenticated;
select is((select jsonb_build_object('muters', o -> 'muters7d', 'mutes', o -> 'mutes7d', 'h4', o -> 'byLength7d' -> 'h4', 'early', o -> 'unmutedEarly7d', 'now', o -> 'mutedNow')
  from public.admin_needs_you_overview() o),
  '{"muters": 1, "mutes": 2, "h4": 1, "early": 2, "now": 0}'::jsonb, 'Admin: who muted, how long, unmuted early');
reset role;

select * from finish();
