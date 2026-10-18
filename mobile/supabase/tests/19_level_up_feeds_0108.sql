-- 0108: going up a level fills a Classic hound's hearts; more XP within
-- the same level doesn't.
select plan(3);

select tests.new_user('Ann') as ann \gset
select (now() at time zone 'utc')::date as today \gset
update public.profiles set xp_total = 0 where id = :'ann';

select tests.sign_in(:'ann');
set local role authenticated;
select public.set_kennel(:'today', null, 'classic');
reset role;

-- Three days unfed: no hearts.
update public.kennels set hearts_on = :'today'::date - 3 where user_id = :'ann';

-- XP that stays in level 0 (level 1 is at 30).
update public.profiles set xp_total = 10 where id = :'ann';
select tests.sign_in(:'ann');
set local role authenticated;
select is((select hearts from public.my_kennel(:'today')), 0, 'More XP in the same level doesn''t feed the hound');
reset role;

-- Up to level 1.
update public.profiles set xp_total = 40 where id = :'ann';
select tests.sign_in(:'ann');
set local role authenticated;
select is((select hearts from public.my_kennel(:'today')), 3, 'A level-up fills the hearts');
select is((select mood from public.my_kennel(:'today')) <> 'hungry', true, 'and the hound isn''t hungry any more');
reset role;

select * from finish();
