-- 0179: a hound Bingo card's size can be picked (3x3, 4x4 or 5x5)
-- whatever the length; left empty, it's sized by length as before. The
-- creator sees their card while setting it up, and gets that card.
select plan(16);

select tests.new_user('Ann', true) as ann \gset
select tests.new_user('Bob') as bob \gset

-- A week with a 5x5 card, published by an admin.
select tests.sign_in(:'ann');
set local role authenticated;
select public.publish_global_challenge('Big week', 'bingo', 7, now(), now() + interval '7 days',
  p_bingo_card_type => 'hound', p_bingo_size => 5) as big \gset
select public.publish_global_challenge('Plain week', 'bingo', 7, now(), now() + interval '7 days',
  p_bingo_card_type => 'hound') as plain \gset
select throws_ok($$ select public.publish_global_challenge('Huge', 'bingo', 7, now(), now() + interval '7 days',
  p_bingo_card_type => 'hound', p_bingo_size => 6) $$, 'A Bingo card is 3×3, 4×4 or 5×5.', 'Only 3, 4 or 5');
reset role;

select is((select bingo_size from public.challenges where id = :'big'), 5::smallint, 'The size is kept');
select is((select bingo_size from public.challenges where id = :'plain'), null, 'or left empty');

insert into public.challenge_participants (challenge_id, user_id) values (:'big', :'bob'), (:'plain', :'bob');
select is((select array_length(squares, 1) from public.bingo_cards where challenge_id = :'big' and user_id = :'bob'),
  25, 'A week with a 5x5 deals 25 squares');
select is((select squares[14] from public.bingo_cards where challenge_id = :'big' and user_id = :'bob'),
  'free', 'with FREE in the N column');
select is((select array_length(squares, 1) from public.bingo_cards where challenge_id = :'plain' and user_id = :'bob'),
  9, 'An empty size still sizes by length');

-- A friends' challenge sets it on the row: a long one with a small card.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, bingo_card_type, bingo_size) values
  ('00000000-0000-0000-0000-0000000000c9', 'Month, small card', 'bingo', :'ann', 30, now() - interval '1 hour', now() + interval '29 days', 'hound', 3);
select tests.sign_in(:'ann');
set local role authenticated;
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000c9', :'ann');
select is(array_length(public.my_bingo_card('00000000-0000-0000-0000-0000000000c9'), 1), 9, 'A month with a 3x3 deals 9 squares');
reset role;
select throws_ok($$ update public.challenges set bingo_size = 7 where id = '00000000-0000-0000-0000-0000000000c9' $$,
  '23514', null, 'The column only takes 3, 4 or 5');

-- Classic (non-hound) cards ignore it.
select tests.sign_in(:'ann');
set local role authenticated;
select is((select bingo_size from public.challenges where id = public.publish_global_challenge('Classic', 'bingo', 7, now(), now() + interval '7 days',
  p_bingo_card_type => 'variety', p_bingo_size => 5)), null, 'A classic card has no size');
reset role;

-- The creator's card: dealt on the Create screen, theirs when they join.
select tests.new_user('Cat') as cat \gset
select tests.sign_in(:'cat');
set local role authenticated;
select public.deal_bingo_card_draft(4);
select array_length(public.deal_bingo_card_draft(5), 1) as n \gset
select throws_ok('select public.deal_bingo_card_draft(6)', 'A Bingo card is 3×3, 4×4 or 5×5.', 'A preview is 3, 4 or 5 too');
reset role;
select is(:n, 25, 'A 5x5 preview has 25 squares');
select squares as shown from public.bingo_card_drafts where user_id = :'cat' \gset
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, bingo_card_type, bingo_size) values
  ('00000000-0000-0000-0000-0000000000ca', 'Cat''s week', 'bingo', :'cat', 7, now() - interval '1 hour', now() + interval '6 days', 'hound', 5);
select tests.sign_in(:'cat');
set local role authenticated;
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000ca', :'cat');
select is(public.my_bingo_card('00000000-0000-0000-0000-0000000000ca'), :'shown'::text[], 'The creator gets the card they saw');
reset role;
select is((select count(*)::int from public.bingo_card_drafts where user_id = :'cat'), 0, 'and the preview is used up');
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000ca', :'bob');
select is((select array_length(squares, 1) from public.bingo_cards where challenge_id = '00000000-0000-0000-0000-0000000000ca' and user_id = :'bob'),
  25, 'Everyone else gets their own card of that size');

-- A preview at another size isn't used.
select tests.sign_in(:'cat');
set local role authenticated;
select public.deal_bingo_card_draft(3);
reset role;
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, bingo_card_type, bingo_size) values
  ('00000000-0000-0000-0000-0000000000cb', 'Cat''s 4x4', 'bingo', :'cat', 7, now() - interval '1 hour', now() + interval '6 days', 'hound', 4);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000cb', :'cat');
select is((select array_length(squares, 1) from public.bingo_cards where challenge_id = '00000000-0000-0000-0000-0000000000cb' and user_id = :'cat'),
  16, 'A 3x3 preview doesn''t go on a 4x4');
select is((select size from public.bingo_card_drafts where user_id = :'cat'), 3::smallint, 'and stays for later');

select * from finish();
