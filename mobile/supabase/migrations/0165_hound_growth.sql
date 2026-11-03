-- Hound: the Hound grows with you (lifestyle phase 3).
--
-- Fitness: a slow measure, level 1 to 10, from active days ever (5,000
-- steps or more). It only goes up; a missed day just slows it. A fitter
-- hound strolls with more bounce and more often.
--
-- Traits: habits become traits on the Hound's profile, once earned kept
-- for good (Early bird, Night owl, Trail dog…), shown to friends too.
--
-- Age: a puppy, then young, then grown, with the steps since it was born
-- (100,000, then 400,000). Hounds from before this migration are already
-- grown. And a birthday: the day it was born, or one you pick (it can
-- change once every 30 days). On it, the yard has a party, and a friend's
-- hound comes round.
--
--   kennels.born_on, birthday, birthday_set_on, grown_before
--   hound_traits            the traits each hound has earned, and when
--   hound_profile()         the read behind both of these (internal)
--   my_hound_profile()      yours; awards any trait newly earned
--   friend_hound_profile()  a friend's, read only
--   set_hound_birthday()
--   admin_growth_overview() Admin → Overview → Growth
--
-- Run this once, after 0001-0164, in the SQL Editor.

alter table public.kennels
  add column born_on date,
  add column birthday date,
  add column birthday_set_on date,
  add column grown_before boolean not null default false;

-- Every hound so far was born when its kennel was made, and is grown.
update public.kennels k set born_on = k.created_at::date, grown_before = true where k.born_on is null;
alter table public.kennels alter column born_on set default current_date;

create table public.hound_traits (
  user_id uuid not null references public.profiles (id) on delete cascade,
  trait text not null check (trait in (
    'early_bird', 'night_owl', 'lunch_stroller', 'trail_dog', 'well_watered',
    'weekend_warrior', 'steady_paws', 'collector', 'green_paws'
  )),
  earned_at timestamptz not null default now(),
  primary key (user_id, trait)
);

alter table public.hound_traits enable row level security;
revoke all on public.hound_traits from anon, authenticated;

-- Active days for each fitness level: 1 at 0, 10 at 100.
create or replace function public.hound_fitness_steps()
returns integer[]
language sql
immutable
as $$
  select array[0, 3, 7, 14, 21, 30, 45, 60, 80, 100];
$$;

revoke execute on function public.hound_fitness_steps() from public, anon, authenticated;

-- The traits a hound's habits have earned, as of p_day: walks and days
-- in the 30 days to p_day, finds and blooms ever.
create or replace function public.hound_trait_check(p_user uuid, p_day date)
returns text[]
language sql
stable
security definer set search_path = public
as $$
  select array_remove(array[
    case when (select count(*) from public.hound_walks w where w.user_id = p_user and w.day > p_day - 30 and w.day <= p_day and w.start_minute < 480) >= 8 then 'early_bird' end,
    case when (select count(*) from public.hound_walks w where w.user_id = p_user and w.day > p_day - 30 and w.day <= p_day and w.start_minute >= 1140) >= 8 then 'night_owl' end,
    case when (select count(*) from public.hound_walks w where w.user_id = p_user and w.day > p_day - 30 and w.day <= p_day and w.start_minute >= 660 and w.start_minute < 840) >= 8 then 'lunch_stroller' end,
    case when (select count(*) from public.hound_walks w where w.user_id = p_user and w.day > p_day - 30 and w.day <= p_day and w.distance_m >= 4800) >= 3 then 'trail_dog' end,
    case when (select count(*) from public.water_days d where d.user_id = p_user and d.day > p_day - 30 and d.day <= p_day) >= 15 then 'well_watered' end,
    case when (select count(*) from public.daily_step_totals s where s.user_id = p_user and s.day > p_day - 30 and s.day <= p_day and s.steps >= 10000 and extract(isodow from s.day) in (6, 7)) >= 4 then 'weekend_warrior' end,
    case when (select count(*) from public.daily_step_totals s where s.user_id = p_user and s.day > p_day - 30 and s.day <= p_day and s.steps >= 5000) >= 20 then 'steady_paws' end,
    case when (select count(distinct w.find_id) from public.hound_walks w where w.user_id = p_user and w.find_id is not null) >= 15 then 'collector' end,
    case when (select count(*) from public.garden_plantings g where g.user_id = p_user and g.bloomed_at is not null) >= 5 then 'green_paws' end
  ], null);
$$;

revoke execute on function public.hound_trait_check(uuid, date) from public, anon, authenticated;

-- A friend's hound for the party, the same shape as yard_view's guest.
create or replace function public.hound_party_guest(p_user uuid, p_day date)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  friend uuid;
  guest jsonb;
begin
  select f.other into friend
  from (
    select case when fr.requester_id = p_user then fr.recipient_id else fr.requester_id end as other
    from public.friendships fr
    where fr.status = 'accepted' and (fr.requester_id = p_user or fr.recipient_id = p_user)
  ) f
  join public.kennels k on k.user_id = f.other
  order by md5(f.other::text || p_day::text)
  limit 1;
  if friend is null then
    return null;
  end if;
  select jsonb_build_object(
      'user_id', friend,
      'owner', case when p.use_username and p.username is not null then p.username else p.name end,
      'name', v.name,
      'xp_total', p.xp_total,
      'neck_id', v.neck_id,
      'head_id', v.head_id,
      'face_id', v.face_id,
      'coat_id', v.coat_id,
      'ears', v.ears,
      'tail', v.tail,
      'markings', v.markings,
      'breed_id', v.breed_id,
      'body_id', v.body_id,
      'feet_id', v.feet_id
    )
    into guest
  from public.kennel_view(friend, p_day) v
  cross join public.profiles p
  where p.id = friend;
  return guest;
end;
$$;

revoke execute on function public.hound_party_guest(uuid, date) from public, anon, authenticated;

-- Fitness, age, birthday and traits, as of p_day.
create or replace function public.hound_profile(p_user uuid, p_day date)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  k public.kennels;
  active integer;
  steps_since bigint;
  lvl integer := 1;
  levels integer[] := public.hound_fitness_steps();
  i integer;
  stage text;
  bday date;
  is_bday boolean;
begin
  select * into k from public.kennels x where x.user_id = p_user;
  if not found then
    k.born_on := p_day;
    k.grown_before := false;
  end if;
  select count(*)::integer into active from public.daily_step_totals s
    where s.user_id = p_user and s.steps >= 5000 and s.day <= p_day;
  for i in 1 .. array_length(levels, 1) loop
    if active >= levels[i] then lvl := i; end if;
  end loop;
  select coalesce(sum(s.steps), 0) into steps_since from public.daily_step_totals s
    where s.user_id = p_user and s.day >= coalesce(k.born_on, p_day) and s.day <= p_day;
  stage := case
    when k.grown_before or steps_since >= 400000 then 'grown'
    when steps_since >= 100000 then 'young'
    else 'puppy'
  end;
  bday := coalesce(k.birthday, k.born_on, p_day);
  -- 29 February falls on the 28th in other years.
  is_bday := to_char(bday, 'MM-DD') = to_char(p_day, 'MM-DD')
    or (to_char(bday, 'MM-DD') = '02-29' and to_char(p_day, 'MM-DD') = '02-28'
        and extract(day from (date_trunc('year', p_day::timestamp) + interval '2 months' - interval '1 day')) = 28);
  return jsonb_build_object(
    'name', coalesce(k.name, 'Scout'),
    'active_days', active,
    'fitness', lvl,
    'fitness_from', levels[lvl],
    'fitness_next', case when lvl < array_length(levels, 1) then levels[lvl + 1] end,
    'stage', stage,
    'steps_since_born', steps_since,
    'grown_before', k.grown_before,
    'born_on', k.born_on,
    'birthday', bday,
    'birthday_set_on', k.birthday_set_on,
    'is_birthday', is_bday,
    'traits', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.trait, 'earned_at', t.earned_at) order by t.earned_at desc)
      from public.hound_traits t where t.user_id = p_user
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.hound_profile(uuid, date) from public, anon, authenticated;

-- Yours: first awards any trait your habits have newly earned. On your
-- hound's birthday, a friend's hound for the party.
create or replace function public.my_hound_profile(p_day date)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_day);
  t text;
  out jsonb;
begin
  foreach t in array public.hound_trait_check(me, p_day) loop
    insert into public.hound_traits (user_id, trait) values (me, t) on conflict do nothing;
  end loop;
  out := public.hound_profile(me, p_day);
  if (out ->> 'is_birthday')::boolean then
    out := out || jsonb_build_object('party_guest', public.hound_party_guest(me, p_day));
  end if;
  return out;
end;
$$;

revoke execute on function public.my_hound_profile(date) from public, anon;
grant execute on function public.my_hound_profile(date) to authenticated;

create or replace function public.friend_hound_profile(p_friend uuid, p_day date)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  utc_today date := (now() at time zone 'utc')::date;
begin
  if auth.uid() is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_day is null or p_day < utc_today - 1 or p_day > utc_today + 1 then
    raise exception 'Invalid date.';
  end if;
  if public.friend_relation(auth.uid(), p_friend) <> 'friends' then
    raise exception 'Only friends can see each other''s hounds.';
  end if;
  return public.hound_profile(p_friend, p_day) - 'steps_since_born' - 'birthday_set_on';
end;
$$;

revoke execute on function public.friend_hound_profile(uuid, date) from public, anon;
grant execute on function public.friend_hound_profile(uuid, date) to authenticated;

-- Your hound's birthday (the year doesn't matter). Once every 30 days,
-- so it can't be every day.
create or replace function public.set_hound_birthday(p_day date, p_birthday date)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_day);
  last_set date;
begin
  if p_birthday is null then
    raise exception 'Pick a day.';
  end if;
  select k.birthday_set_on into last_set from public.kennels k where k.user_id = me;
  if last_set is not null and last_set > p_day - 30 then
    raise exception 'The birthday can change once a month. Try again after %.', to_char(last_set + 30, 'FMMonth FMDD');
  end if;
  update public.kennels k set birthday = p_birthday, birthday_set_on = p_day where k.user_id = me;
  return public.my_hound_profile(p_day);
end;
$$;

revoke execute on function public.set_hound_birthday(date, date) from public, anon;
grant execute on function public.set_hound_birthday(date, date) to authenticated;

-- Admin → Overview → Growth: fitness levels, traits, ages, birthdays.
create or replace function public.admin_growth_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'utc')::date;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;

  return (
    with hounds as (
      select k.user_id, public.hound_profile(k.user_id, today) as hp
      from public.kennels k
      join public.profiles p on p.id = k.user_id
      where p.last_active_at > now() - interval '30 days'
    )
    select jsonb_build_object(
      'hounds', (select count(*) from hounds),
      'by_fitness', coalesce((
        select jsonb_agg(jsonb_build_object('level', x.lvl, 'count', x.n) order by x.lvl)
        from (select (h.hp ->> 'fitness')::int as lvl, count(*) as n from hounds h group by 1) x
      ), '[]'::jsonb),
      'by_stage', jsonb_build_object(
        'puppy', (select count(*) from hounds h where h.hp ->> 'stage' = 'puppy'),
        'young', (select count(*) from hounds h where h.hp ->> 'stage' = 'young'),
        'grown', (select count(*) from hounds h where h.hp ->> 'stage' = 'grown')
      ),
      'with_trait', (select count(distinct t.user_id) from public.hound_traits t),
      'traits_7d', (select count(*) from public.hound_traits t where t.earned_at > now() - interval '7 days'),
      'by_trait', coalesce((
        select jsonb_agg(jsonb_build_object('id', x.trait, 'count', x.n) order by x.n desc)
        from (select t.trait, count(*) as n from public.hound_traits t group by t.trait) x
      ), '[]'::jsonb),
      'birthdays_set', (select count(*) from public.kennels k where k.birthday_set_on is not null),
      'birthdays_today', (select count(*) from hounds h where (h.hp ->> 'is_birthday')::boolean)
    )
  );
end;
$$;

revoke execute on function public.admin_growth_overview() from public, anon;
grant execute on function public.admin_growth_overview() to authenticated;
