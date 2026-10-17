-- 0103: one dig a day, only after a goal day; what it pays lands in the
-- balance; nobody can write their own digs; the 5th piece unlocks the
-- Fossil Ring, which the shop won't sell.
select plan(10);

select tests.new_user('Ann') as ann \gset
select (now() at time zone 'utc')::date as today \gset
select bones_balance as ann_bones from public.profiles where id = :'ann' \gset

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok(format('select * from public.dig_bone(%L)', :'today'),
  'Finish today''s goals first.', 'No goal day, no dig');
reset role;

insert into public.goal_streaks (user_id, streak, best_streak, last_hit_on) values (:'ann', 1, 1, :'today');

select tests.sign_in(:'ann');
set local role authenticated;
select is((select dug_today from public.my_bone_dig(:'today')), false, 'Not dug yet');
select ok((select prize from public.dig_bone(:'today')) in ('bones', 'piece'), 'A goal day digs something up');
select throws_ok(format('select * from public.dig_bone(%L)', :'today'),
  'You''ve already dug today. Come back tomorrow.', 'One dig a day');
select is((select dug_today from public.my_bone_dig(:'today')), true, 'Today shows as dug');
select throws_ok(format('insert into public.bone_digs (user_id, day, prize) values (%L, %L, ''piece'')', :'ann', (:'today'::date - 1)),
  '42501', null, 'Nobody can write their own digs');
reset role;

select is((select bones_balance from public.profiles where id = :'ann'),
  :ann_bones + (select bones from public.bone_digs where user_id = :'ann' and day = :'today'),
  'What the dig paid is in the balance');

-- Four pieces already, then dig again until today's dig is a piece.
delete from public.bone_digs where user_id = :'ann';
insert into public.bone_digs (user_id, day, prize)
  select :'ann', :'today'::date - g, 'piece' from generate_series(2, 5) g;
select tests.sign_in(:'ann');
do $$
declare
  got text;
  tries int := 0;
begin
  loop
    delete from public.bone_digs where user_id = auth.uid() and day = (now() at time zone 'utc')::date;
    select prize into got from public.dig_bone((now() at time zone 'utc')::date);
    tries := tries + 1;
    exit when got = 'piece' or tries >= 500;
  end loop;
end $$;
select is((select count(*)::int from public.bone_digs where user_id = :'ann' and prize = 'piece'), 5, 'A fifth piece');
select ok(exists (select 1 from public.cosmetic_purchases where user_id = :'ann' and item_id = 'frame_fossil'),
  'Five pieces unlock the Fossil Ring');

set local role authenticated;
select throws_ok('select public.purchase_cosmetic(''bg_dig_site'')', 'That item isn''t sold in the shop.',
  'Dig items can''t be bought');
reset role;

select * from finish();
