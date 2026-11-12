-- 0191: dog photos as avatars, friends only, reports, admin review and
-- upload blocks.
select plan(25);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bea') as bea \gset
select tests.new_user('Cal') as cal \gset
select tests.new_user('Dan') as dan \gset
select tests.new_user('Eve') as eve \gset
select tests.new_user('Ada', true) as ada \gset

insert into public.friendships (requester_id, recipient_id, status) values
  (:'ann', :'bea', 'accepted'), (:'dan', :'ann', 'accepted'), (:'ann', :'eve', 'accepted');
update public.profiles set equipped_icon_id = public.kennel_avatar_code(id) where id = :'ann';

-- The function's side (service role).
set local role service_role;
select is(public.dog_photo_may_try(:'ann'), null, 'Ann may try a photo');
select is(public.dog_photo_checked(:'ann', false, 'not a dog', null, null), null, 'A photo that fails is only counted');
select isnt(public.dog_photo_checked(:'ann', true, null, :'ann' || '/a.jpg', '{"breed":"retriever"}'), null, 'A photo that passes is stored');
reset role;

select tests.sign_in(:'ann');
set local role authenticated;
select throws_ok($$select * from public.dog_photos$$, '42501', null, 'Nobody reads the photo table directly');
select is(public.my_dog_photo() ->> 'status', 'pending', 'It waits until Ann uses it');
select is((public.my_dog_photo() ->> 'tries_left')::int, 3, 'Two of five tries used today');
select public.dog_photo_use((public.my_dog_photo() ->> 'photo_id')::uuid);
select matches((select equipped_icon_id from public.profiles where id = :'ann'), '^hound:([^.]*\.){7}[^.]*\.~[0-9a-f]+$', 'Her avatar code is the hound with the photo token on the end');
select is(array_length(string_to_array(split_part((select equipped_icon_id from public.profiles where id = :'ann'), ':', 2), '.'), 1), 9, 'Older builds read the first eight parts and draw the hound');
select is(public.can_see_dog_photo(:'ann' || '/a.jpg'), true, 'Ann sees her own photo');
reset role;

select tests.sign_in(:'bea');
set local role authenticated;
select is((select count(*)::int from public.friend_dog_photos() where user_id = :'ann'), 1, 'A friend gets Ann''s photo');
select is(public.can_see_dog_photo(:'ann' || '/a.jpg'), true, 'and Storage serves it to her');
select public.report_dog_photo(:'ann', 'Not a dog');
reset role;

select tests.sign_in(:'cal');
set local role authenticated;
select is((select count(*)::int from public.friend_dog_photos()), 0, 'Someone who isn''t a friend gets no photos');
select is(public.can_see_dog_photo(:'ann' || '/a.jpg'), false, 'and Storage won''t serve the file');
select throws_ok(format('select public.report_dog_photo(%L)', :'ann'), 'You can only report a friend''s photo.', 'Only friends can report it');
reset role;

select tests.sign_in(:'dan');
set local role authenticated;
select public.report_dog_photo(:'ann');
reset role;
select tests.sign_in(:'eve');
set local role authenticated;
select public.report_dog_photo(:'ann', 'Rude');
reset role;

select is((select status from public.dog_photos where user_id = :'ann' and path like '%/a.jpg'), 'hidden', 'Three friends reporting it hide it');
select unalike((select equipped_icon_id from public.profiles where id = :'ann'), '%.~%', 'and her avatar goes back to the hound');

select id as photo from public.dog_photos where user_id = :'ann' and path like '%/a.jpg' \gset
select tests.sign_in(:'ada');
set local role authenticated;
select is((public.admin_dog_photos_overview() ->> 'to_review')::int, 1, 'Admin sees one to review');
select is((public.admin_dog_photos_overview() -> 'reported' -> 0 ->> 'reports')::int, 3, 'with its three reports');
select public.admin_review_dog_photo(:'photo'::uuid, true);
select alike((select equipped_icon_id from public.profiles where id = :'ann'), '%.~%', 'Keeping it puts the photo back');
select public.admin_block_dog_uploads(:'ann', -1);
reset role;
select is((select status from public.dog_photos where path = :'ann' || '/a.jpg'), 'removed', 'Blocking uploads takes the photo down');

set local role service_role;
select is(public.dog_photo_may_try(:'ann'), 'Photo uploads are off for your account.', 'and stops her checking new ones');
select ok((select count(*) from public.dog_photo_take_purgeable(:'ann')) >= 1, 'The removed file is handed back to delete');
reset role;

select tests.sign_in(:'ada');
set local role authenticated;
select public.admin_block_dog_uploads(:'ann', 0);
reset role;
insert into public.dog_photo_attempts (user_id, ok) select :'ann', true from generate_series(1, 3);
set local role service_role;
select is(public.dog_photo_may_try(:'ann'), 'You''ve tried a few photos today. Try again tomorrow.', 'Unblocked, but five tries a day is the limit');
reset role;

select tests.sign_in(:'bea');
set local role authenticated;
select throws_ok($$select public.admin_dog_photos_overview()$$, 'not authorized', 'Only admins see the overview');
select throws_ok(format('select public.admin_block_dog_uploads(%L, -1)', :'ann'), 'not authorized', 'or block anyone');
reset role;

select * from finish();
