-- 0144: a Hound'opoly player's join day follows their own calendar, and
-- joining on or before the first day means rolling from day 1.
select plan(5);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
update public.profiles set time_zone = 'America/New_York' where id in (:'ann', :'bob');

-- Made this evening in New York, which may already be tomorrow in UTC.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-0000000000d1', 'Evening game', 'houndopoly', :'ann', 21, now() - interval '1 hour', now() + interval '20 days',
   (now() at time zone 'America/New_York')::date);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000d1', :'ann');
select is((select joined_day from public.houndopoly_players where challenge_id = '00000000-0000-0000-0000-0000000000d1' and user_id = :'ann'),
  (now() at time zone 'America/New_York')::date - 1, 'The creator rolls from day 1');

-- Bob joins five days into a game: his turns start the next day, his day.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day) values
  ('00000000-0000-0000-0000-0000000000d2', 'Old game', 'houndopoly', :'ann', 21, now() - interval '5 days', now() + interval '16 days',
   (now() at time zone 'America/New_York')::date - 5);
insert into public.challenge_participants (challenge_id, user_id) values ('00000000-0000-0000-0000-0000000000d2', :'ann'), ('00000000-0000-0000-0000-0000000000d2', :'bob');
select is((select joined_day from public.houndopoly_players where challenge_id = '00000000-0000-0000-0000-0000000000d2' and user_id = :'bob'),
  (now() at time zone 'America/New_York')::date, 'A late joiner''s day is their own local day');
select is((select joined_day from public.houndopoly_players where challenge_id = '00000000-0000-0000-0000-0000000000d2' and user_id = :'ann'),
  (now() at time zone 'America/New_York')::date, 'Joining mid-game counts from the day after, even for the creator');

-- The rule itself, at a fixed moment: 01:23 UTC on Nov 1 is Oct 31 in New York.
update public.challenges set start_day = '2026-10-31' where id = '00000000-0000-0000-0000-0000000000d1';
select is(public.houndopoly_join_day('00000000-0000-0000-0000-0000000000d1', :'ann', '2026-11-01 01:23:54+00'),
  '2026-10-30'::date, 'An evening creation on the first day rolls from day 1');
select is(public.houndopoly_join_day('00000000-0000-0000-0000-0000000000d1', :'bob', '2026-11-03 01:23:54+00'),
  '2026-11-02'::date, 'An evening join on day 3 rolls from day 4');

select * from finish();
