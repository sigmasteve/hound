-- 0217: all play counts toward "Earned by playing", bought and passed-on
-- Bones don't, and a locked game can't be created until it's earned.
select plan(10);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Ada', true) as ada \gset
-- XP set mid-level, so the habit XP these claims give doesn't level up (a
-- level up pays its own earned Bones).
update public.profiles set bones_earned_total = 0, xp_total = 100000, last_active_at = now() where id in (:'ann', :'ada');

-- Play counts.
insert into public.activity_events (user_id, kind, bones_points) values
  (:'ann', 'goal_day', 5), (:'ann', 'goal_week', 15), (:'ann', 'daily_bonus', 10),
  (:'ann', 'bone_dig', 20), (:'ann', 'achievement', 25), (:'ann', 'onboarding_reward', 50);
select is((select bones_earned_total from public.profiles where id = :'ann'), 125,
  'Goal days, goal weeks, the daily bonus, Bone Dig, badges and setup all count');

-- Ads and bounties don't.
insert into public.activity_events (user_id, kind, bones_points) values (:'ann', 'ad_reward', 10), (:'ann', 'bounty_won', 40);
select is((select bones_earned_total from public.profiles where id = :'ann'), 125, 'Ads and bounties don''t count');

-- Bought Bones don't.
update public.profiles set bones_balance = 0 where id = :'ann';
select public.credit_bones_purchase(:'ann', 'app_store', 'bones_pack_small', 'txn-114-1');
select is((select bones_balance from public.profiles where id = :'ann'), 100, 'A pack adds to the balance');
select is((select bones_earned_total from public.profiles where id = :'ann'), 125, 'but not to Bones earned');

-- Locked games.
insert into public.challenge_unlock_gates (kind, bones_required) values ('rally', 200)
  on conflict (kind) do update set bones_required = excluded.bones_required;
delete from public.challenge_unlock_gates where kind = 'steps';

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok(format($q$insert into public.challenges (name, kind, created_by, duration_days, starts_at, ends_at)
    values ('Rally', 'rally', %L, 7, now(), now() + interval '7 days')$q$, :'ann'),
  'This game opens at 200 Bones earned by playing.', 'A locked game can''t be created');
select lives_ok(format($q$insert into public.challenges (name, kind, created_by, duration_days, starts_at, ends_at)
    values ('Steps', 'steps', %L, 7, now(), now() + interval '7 days')$q$, :'ann'),
  'An open game can');
reset role;

insert into public.activity_events (user_id, kind, bones_points) values (:'ann', 'goal_day', 75);
select tests.sign_in(:'ann');
set local role authenticated;
select lives_ok(format($q$insert into public.challenges (name, kind, created_by, duration_days, starts_at, ends_at)
    values ('Rally', 'rally', %L, 7, now(), now() + interval '7 days')$q$, :'ann'),
  'At 200 earned, it opens');
select throws_ok($q$select public.admin_challenge_unlocks_overview()$q$, 'not authorized', 'Admin numbers are admins only');
reset role;

select tests.sign_in(:'ada');
set local role authenticated;
select is((select (g ->> 'reached')::int from jsonb_array_elements(public.admin_challenge_unlocks_overview() -> 'gates') g where g ->> 'kind' = 'rally'),
  1, 'Admin sees who has reached a locked game');
select is((select (g ->> 'made_30d')::int from jsonb_array_elements(public.admin_challenge_unlocks_overview() -> 'gates') g where g ->> 'kind' = 'rally') >= 1,
  true, 'and how many were made');
reset role;

select * from finish();
