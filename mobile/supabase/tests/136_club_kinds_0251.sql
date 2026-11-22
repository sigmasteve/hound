-- 0251: Bullseye, Long Shot, Paw Slots and Hound Roulette can go on a
-- club's page; one-on-one and fixed-team games still can't.
select plan(7);

select ok(public.club_kind_ok('bullseye'), 'Bullseye can be posted to a club');
select ok(public.club_kind_ok('longshot'), 'Long Shot can be posted to a club');
select ok(public.club_kind_ok('slots'), 'Paw Slots can be posted to a club');
select ok(public.club_kind_ok('roulette'), 'Hound Roulette can be posted to a club');
select ok(public.club_kind_ok('steps'), 'Steps still can');
select ok(not public.club_kind_ok('chess'), 'Chess (one on one) still can''t');
select ok(not public.club_kind_ok('soccer'), 'Soccer (fixed teams) still can''t');

select * from finish();
