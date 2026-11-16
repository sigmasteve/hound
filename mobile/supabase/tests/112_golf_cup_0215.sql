-- 0215: full shots drop within 1.0 yd of the pin; putts still need 0.6.
select plan(4);

select is((select cup from public.golf_config), 1.00::numeric(3, 2), 'The cup for full shots is 1.0 yd');
select is((select putt_cup from public.golf_config), 0.60::numeric(3, 2), 'Putts are unchanged');

-- A straight hole, pin at 400 on a flat green.
insert into public.golf_courses (id, name, style, sort) values ('zzcup', 'Cup Park', 'park', 99);
insert into public.golf_holes (course_id, no, par, length, name, hole) values ('zzcup', 1, 3, 400, 'Cup', jsonb_build_object(
  'no', 1, 'par', 3, 'length', 400, 'name', 'Cup',
  'center', '[[0,0],[400,0]]'::jsonb, 'fairway_w', 20, 'fairway_from', 30, 'fairway_to', 388,
  'green', '{"d":400,"lat":0,"r":14,"break":0}'::jsonb, 'pin', '{"d":400,"lat":0}'::jsonb,
  'hazards', '[]'::jsonb, 'ob', 70, 'wind', '{"mph":0,"deg":90}'::jsonb, 'slope', null));

-- A pure 96-yard wedge from 300.2 lands at 396.2 and rolls 3% to 399.08:
-- 0.92 yd from the pin.
select is((public.golf_flight((select hole from public.golf_holes where course_id = 'zzcup'),
    300.2, 0, 'fairway', 'wedge', 96, 0, 0, 0, 0, 90, (public.golf_cfg()).putt_cup, (public.golf_cfg()).cup)) ->> 'holed', 'true',
  'Stopping 0.92 yd from the pin drops now');
select is((public.golf_flight((select hole from public.golf_holes where course_id = 'zzcup'),
    300.2, 0, 'fairway', 'wedge', 96, 0, 0, 0, 0, 90, 0.6, 0.6)) ->> 'holed', 'false',
  'It didn''t with the old 0.6');

select * from finish();
