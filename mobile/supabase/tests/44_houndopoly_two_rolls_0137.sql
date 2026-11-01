-- 0137: two turns a day. The midday turn counts the steps synced so far,
-- the overnight turn the rest; tiers are halved per turn; a day that
-- already rolled overnight under the old rule gets no midday turn.
select plan(9);

select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select (now() at time zone 'utc')::date as today \gset

insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, start_day)
values ('99999999-0000-0000-0000-000000000020', 'Two a day', 'houndopoly', :'ann', 21, now() - interval '4 days', now() + interval '17 days', :'today'::date - 4);
insert into public.challenge_participants (challenge_id, user_id) values
  ('99999999-0000-0000-0000-000000000020', :'ann'), ('99999999-0000-0000-0000-000000000020', :'bob');
update public.houndopoly_players set joined_day = :'today'::date - 4 where challenge_id = '99999999-0000-0000-0000-000000000020';

-- Halved tiers per turn.
select is(public.houndopoly_dice(2999, s, 2), 1, 'Under 3,000 steps in a turn: one die') from public.houndopoly_settings s;
select is(public.houndopoly_dice(6000, s, 2), 3, '6,000 in a turn: three dice') from public.houndopoly_settings s;
select is(public.houndopoly_dice(999, s, 2), 0, 'Under 1,000: no roll') from public.houndopoly_settings s;

-- Two days ago, as the server does it: 4,000 steps synced by midday, 9,000 by the end.
insert into public.daily_step_totals (user_id, day, steps) values (:'ann', :'today'::date - 2, 4000), (:'bob', :'today'::date - 2, 500);
select public.houndopoly_roll_day('99999999-0000-0000-0000-000000000020', :'today'::date - 2, 'noon');
select is((select steps || '/' || dice from public.houndopoly_turns where challenge_id = '99999999-0000-0000-0000-000000000020' and user_id = :'ann' and day = :'today'::date - 2 and slot = 'noon'),
  '4000/2', 'The midday turn counts the steps so far: 4,000, two dice');
select is((select slot from public.houndopoly_events where challenge_id = '99999999-0000-0000-0000-000000000020' and user_id = :'bob' and day = :'today'::date - 2 and kind = 'stayed_in'),
  'noon', 'and its events carry the slot');
update public.daily_step_totals set steps = 9000 where user_id = :'ann' and day = :'today'::date - 2;
select public.houndopoly_roll_day('99999999-0000-0000-0000-000000000020', :'today'::date - 2, 'night');
select is((select steps || '/' || dice from public.houndopoly_turns where challenge_id = '99999999-0000-0000-0000-000000000020' and user_id = :'ann' and day = :'today'::date - 2 and slot = 'night'),
  '5000/2', 'The overnight turn counts the rest: 5,000, two dice');
select is((select count(*)::int from public.houndopoly_days where challenge_id = '99999999-0000-0000-0000-000000000020' and day = :'today'::date - 2), 2, 'Two turns on the day');

-- A day rolled overnight under the old rule gets no midday turn after the fact.
insert into public.houndopoly_days (challenge_id, day, slot) values ('99999999-0000-0000-0000-000000000020', :'today'::date - 3, 'night');
select tests.sign_in(:'ann');
set local role authenticated;
select ok(public.houndopoly_advance('99999999-0000-0000-0000-000000000020') >= 1, 'A player can roll what''s due');
reset role;
select is((select count(*)::int from public.houndopoly_days where challenge_id = '99999999-0000-0000-0000-000000000020' and day = :'today'::date - 3), 1,
  'An old once-a-day day stays as it was');

select * from finish();
