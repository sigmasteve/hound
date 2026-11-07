-- Hound: style the hound's hair after its bath (testers' ask, "nothing
-- too fancy").
--
-- Bath time (0177) gains a Style step after the shake: pick a 'do,
-- Fluffy, Curl, Spiky or Bow. The hound keeps it until the next long
-- walk, which brings it home muddy and messy again, the same walk that
-- ends "fresh". A later bath replaces it (a quick bath washes it out).
-- Friends see it too. No Bones: it's just for fun.
--
--   hound_baths      + hairdo
--   hound_hairdo()   the hound's 'do now, or null
--   care_bath()      + hairdo
--   finish_bath()    + p_hairdo (optional, so the 0177 app still works)
--   friend_kennel()  + hairdo
--   admin_bath_overview()  + baths styled, and which 'dos
--
-- Run this once, after 0177, in the SQL Editor, before publishing the
-- app update that goes with it.
--
-- Undo, if needed: re-run care_bath, finish_bath and admin_bath_overview
-- from 0177 (dropping the 4-argument finish_bath first) and friend_kennel
-- from 0156 (dropping this one first); drop hound_hairdo. The column can
-- stay.

alter table public.hound_baths
  add column hairdo text check (hairdo in ('fluffy', 'curl', 'spiky', 'bow'));

-- The 'do from the latest bath, unless a long walk (the one care_long_walk
-- counts: 30 minutes or 3,000 steps, finished 20 minutes ago) has ended
-- since.
create or replace function public.hound_hairdo(p_user uuid)
returns text
language sql
stable
security definer set search_path = public
as $$
  with last as (
    select b.hairdo, b.created_at from public.hound_baths b
    where b.user_id = p_user
    order by b.created_at desc
    limit 1
  )
  select l.hairdo from last l
  where l.hairdo is not null
    and not exists (
      select 1 from public.hound_walks w
      where w.user_id = p_user
        and w.ended_at > l.created_at
        and (w.ended_at - w.started_at >= interval '30 minutes' or w.steps >= 3000)
        and w.ended_at <= now() - interval '20 minutes'
    );
$$;

revoke execute on function public.hound_hairdo(uuid) from public, anon, authenticated;

-- The bath, as the Kennel shows it. From 0177, with the 'do.
create or replace function public.care_bath(p_user uuid, p_day date)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  walk public.hound_walks;
  bath public.hound_baths;
  cfg public.bath_settings;
  steps integer;
  goal boolean;
  pack boolean;
  muddy boolean;
  earned text;
begin
  walk := public.care_long_walk(p_user, p_day);
  select * into bath from public.hound_baths b where b.user_id = p_user and b.day = p_day;
  select * into cfg from public.bath_settings;
  select s.steps into steps from public.daily_step_totals s where s.user_id = p_user and s.day = p_day;
  goal := exists (select 1 from public.goal_streaks g where g.user_id = p_user and g.last_hit_on >= p_day);
  pack := exists (
    select 1 from public.bones_purchases bp
    join public.profiles p on p.id = bp.user_id
    where bp.user_id = p_user and bp.status = 'credited'
      and (bp.created_at at time zone coalesce(p.time_zone, 'UTC'))::date = p_day
  );
  -- Muddy from a long walk that ended after today's bath (or with no bath).
  muddy := walk.id is not null and (bath.user_id is null or walk.ended_at > bath.created_at);
  earned := case
    when walk.id is not null then 'walk'
    when coalesce(steps, 0) >= 6000 then 'steps'
    when goal then 'goal'
    when pack then 'pack'
  end;
  return jsonb_build_object(
    'bathed', bath.user_id is not null,
    'bathed_at', bath.created_at,
    'bath_kind', bath.kind,
    'bath_bones', bath.bones,
    'muddy', muddy,
    'earned', earned,
    'can_bath', bath.user_id is null and earned is not null,
    'walk_steps', walk.steps,
    'walk_minutes', case when walk.id is null then null
      else round(extract(epoch from walk.ended_at - walk.started_at) / 60)::int end,
    'bubbles', coalesce(cfg.bubbles, 10),
    'golden_bones', coalesce(cfg.golden_bones, 5),
    -- 0178: the 'do, until the next long walk.
    'hairdo', public.hound_hairdo(p_user)
  );
end;
$$;

revoke execute on function public.care_bath(uuid, date) from public, anon, authenticated;

-- The bath you played, with the 'do you picked. From 0177; the old
-- three-argument one goes, and p_hairdo is optional so the 0177 app's
-- call still lands here.
drop function public.finish_bath(date, int, boolean);

create or replace function public.finish_bath(p_day date, p_bubbles int, p_golden boolean, p_hairdo text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_day);
  why text := public.bath_check(me, p_day);
  cfg public.bath_settings;
  n int;
  gold boolean;
  paid int;
begin
  select * into cfg from public.bath_settings;
  n := greatest(0, least(coalesce(p_bubbles, 0), coalesce(cfg.bubbles, 10)));
  gold := coalesce(p_golden, false) and coalesce(cfg.golden_bones, 5) > 0;
  paid := n + case when gold then coalesce(cfg.golden_bones, 5) else 0 end;
  insert into public.hound_baths (user_id, day, kind, earned, bubbles, golden, bones, hairdo)
  values (me, p_day, 'play', why, n, gold, paid,
    case when p_hairdo in ('fluffy', 'curl', 'spiky', 'bow') then p_hairdo end);
  if paid > 0 then
    update public.profiles p
      set bones_balance = p.bones_balance + paid, bones_earned_total = p.bones_earned_total + paid
      where p.id = me;
  end if;
  return public.my_care(p_day);
end;
$$;

revoke execute on function public.finish_bath(date, int, boolean, text) from public, anon;
grant execute on function public.finish_bath(date, int, boolean, text) to authenticated;

-- A friend's hound, for their page. From 0156, with the 'do.
drop function if exists public.friend_kennel(uuid, date);

create function public.friend_kennel(p_friend uuid, p_local_date date)
returns table (
  name text,
  mood text,
  neck_id text,
  head_id text,
  face_id text,
  coat_id text,
  ears text,
  tail text,
  markings text,
  xp_total integer,
  breed_id text,
  body_id text,
  feet_id text,
  hairdo text
)
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
  if p_local_date is null or p_local_date < utc_today - 1 or p_local_date > utc_today + 1 then
    raise exception 'Invalid date.';
  end if;
  if public.friend_relation(auth.uid(), p_friend) <> 'friends' then
    raise exception 'Only friends can see each other''s hounds.';
  end if;
  return query select v.name, v.mood, v.neck_id, v.head_id, v.face_id, v.coat_id, v.ears, v.tail, v.markings, p.xp_total,
    v.breed_id, v.body_id, v.feet_id, public.hound_hairdo(p_friend)
  from public.kennel_view(p_friend, p_local_date) v
  cross join public.profiles p
  where p.id = p_friend;
end;
$$;

revoke execute on function public.friend_kennel(uuid, date) from public, anon;
grant execute on function public.friend_kennel(uuid, date) to authenticated;

-- Admin → Overview → Bath time. From 0177, with the 'dos.
create or replace function public.admin_bath_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  cfg public.bath_settings;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  select * into cfg from public.bath_settings;
  return (
    with wk as (select * from public.hound_baths b where b.created_at > now() - interval '7 days')
    select jsonb_build_object(
      'bubbles', cfg.bubbles,
      'golden_bones', cfg.golden_bones,
      'played_7d', (select count(*) from wk where wk.kind = 'play'),
      'players_7d', (select count(distinct wk.user_id) from wk where wk.kind = 'play'),
      'quick_7d', (select count(*) from wk where wk.kind = 'quick'),
      'bubbles_7d', (select coalesce(sum(wk.bubbles), 0) from wk),
      'golden_7d', (select count(*) from wk where wk.golden),
      'bones_7d', (select coalesce(sum(wk.bones), 0) from wk),
      'all_bubbles_7d', (select count(*) from wk where wk.kind = 'play' and wk.bubbles >= cfg.bubbles),
      'played_all', (select count(*) from public.hound_baths b where b.kind = 'play'),
      'players_all', (select count(distinct b.user_id) from public.hound_baths b where b.kind = 'play'),
      'bones_all', (select coalesce(sum(b.bones), 0) from public.hound_baths b),
      'styled_7d', (select count(*) from wk where wk.hairdo is not null),
      'hairdos_7d', (
        select coalesce(jsonb_object_agg(h.hairdo, h.n), '{}'::jsonb)
        from (select wk.hairdo, count(*) as n from wk where wk.hairdo is not null group by wk.hairdo) h
      ),
      'by_earned_7d', (
        select coalesce(jsonb_object_agg(e.earned, e.n), '{}'::jsonb)
        from (select wk.earned, count(*) as n from wk where wk.earned is not null group by wk.earned) e
      )
    )
  );
end;
$$;

revoke execute on function public.admin_bath_overview() from public, anon;
grant execute on function public.admin_bath_overview() to authenticated;
