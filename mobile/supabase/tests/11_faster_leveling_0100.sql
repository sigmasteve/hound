-- 0100: the gentler level curve, XP for daily habits, and the same
-- level-up Bones however a level is reached.
select plan(9);

select is(public.level_for_xp(29), 0, 'Level 1 takes 30 XP');
select is(public.level_for_xp(30), 1, 'Level 1 at 30 XP');
select is(public.level_for_xp(350), 5, 'Level 5 (Tracker) at 350 XP');
select is(public.level_for_xp(4400), 20, 'Level 20 (Legend) at 4,400 XP');

select tests.new_user('Ann') as ann \gset
select xp_total as ann_xp, bones_balance as ann_bones from public.profiles where id = :'ann' \gset

select tests.sign_in(:'ann');
set local role authenticated;
select public.claim_daily_bonus((now() at time zone 'utc')::date);
select public.ensure_starter_goals(10000, 3);
select public.claim_goal_day((now() at time zone 'utc')::date);
reset role;

select is((select xp_total from public.profiles where id = :'ann'), :ann_xp + 15,
  'Opening Hound and a goal day earn 5 + 10 XP');
select is((select xp_points from public.activity_events where user_id = :'ann' and kind = 'goal_day'), 10,
  'The goal day''s XP is on its ledger row');

-- 25 more XP from the week crosses level 1 (30 XP): 25 Bones, as for any level.
select tests.sign_in(:'ann');
set local role authenticated;
select public.claim_goal_week((now() at time zone 'utc')::date);
reset role;
select is((select xp_total from public.profiles where id = :'ann'), :ann_xp + 40, 'A goal week earns 25 XP');
select is(
  (select bones_balance from public.profiles where id = :'ann')
    - (select coalesce(sum(bones_points), 0) from public.activity_events where user_id = :'ann')::int,
  :ann_bones + 25,
  'Crossing a level pays 25 Bones');

select is((select unlock_xp from public.cosmetic_items where id = 'bg_sunset'), 350,
  'Locker items move with their level (Sunset stays at level 5)');

select * from finish();
