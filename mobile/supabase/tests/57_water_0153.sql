-- 0153: water. Glasses log on your own day and are capped, only you see
-- or remove them, water days need a goal and count once, the badges pay
-- nothing, and checklist items can tick on water days.
select plan(18);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select bones_balance as ann_bones from public.profiles where id = :'ann' \gset

select tests.sign_in(:'ann');
set local role authenticated;
select public.log_water(current_date, 237) as first_glass \gset
select public.log_water(current_date, 500);
select is((select sum(ml)::int from public.water_log where user_id = :'ann' and day = current_date), 737,
  'Glasses add up on the day');
select throws_ok($q$select public.log_water(current_date - 5, 237)$q$, 'Water can only be logged for today.',
  'Not for days long gone');
select throws_ok($q$select public.log_water(current_date, 0)$q$, 'A glass is 1 to 2,000 ml.', 'Not an empty glass');
do $$ begin
  for i in 1..4 loop
    perform public.log_water(current_date, 2000);
  end loop;
end $$;
select throws_ok($q$select public.log_water(current_date, 2000)$q$,
  'That''s more than 10 litres today. Remove an entry if one was a mistake.', 'Capped at 10 litres a day');
select throws_ok($q$select public.claim_water_day(current_date)$q$, 'Set a water goal first.', 'A water day needs a goal');
insert into public.water_goals (user_id, target_ml) values (:'ann', 1893);
select is(public.claim_water_day(current_date), true, 'With one, the day counts');
select is(public.claim_water_day(current_date), false, 'once');
select throws_ok($q$select public.claim_water_day(current_date - 9)$q$, 'Only the last week''s water days can be counted.',
  'Only the last week');
select ok(exists (select 1 from public.check_achievements() where achievement_id = 'water_first'), 'The first water day earns First Sip');
reset role;
select is((select bones_balance from public.profiles where id = :'ann'), :'ann_bones'::int, 'which pays no Bones');

-- Six more days in a row (written directly: claims only reach back a week).
insert into public.water_days (user_id, day) select :'ann', current_date - g from generate_series(1, 6) g;
select tests.sign_in(:'ann');
set local role authenticated;
select ok(exists (select 1 from public.check_achievements() where achievement_id = 'water_7'), 'Seven in a row earns Well Watered');
reset role;
-- 23 more, not in a row with the others.
insert into public.water_days (user_id, day) select :'ann', current_date - 100 - g * 2 from generate_series(1, 23) g;
select tests.sign_in(:'ann');
set local role authenticated;
select ok(exists (select 1 from public.check_achievements() where achievement_id = 'water_30'), 'Thirty in all earns Watering Hole');
reset role;

-- Privacy.
select tests.sign_in(:'bob');
set local role authenticated;
select is((select count(*)::int from public.water_log where user_id = :'ann'), 0, 'Nobody else sees your water');
select is((select count(*)::int from public.water_goals where user_id = :'ann'), 0, 'or your water goal');
delete from public.water_log where id = :'first_glass';
reset role;
select is((select count(*)::int from public.water_log where id = :'first_glass'), 1, 'and nobody else can remove a glass');

select tests.sign_in(:'ann');
set local role authenticated;
delete from public.water_log where id = :'first_glass';
reset role;
select is((select count(*)::int from public.water_log where id = :'first_glass'), 0, 'but you can (Undo)');

-- Checklist items that tick on water days.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at)
values ('57575757-0000-0000-0000-000000000001', 'Habits', 'checklist', :'ann', 14, now(), now() + interval '14 days');
select lives_ok($q$insert into public.checklist_items (challenge_id, label, kind)
  values ('57575757-0000-0000-0000-000000000001', 'Drink enough water', 'water')$q$, 'A checklist item can tick on water days');
select throws_ok($q$insert into public.checklist_items (challenge_id, label, kind)
  values ('57575757-0000-0000-0000-000000000001', 'Juice', 'juice')$q$, '23514', null, 'but kinds are still checked');

select * from finish();
