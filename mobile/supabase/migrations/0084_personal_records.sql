-- Hound: personal records — each person's bests, shown on Your data.
--
--   best_day_steps       most steps in one day
--   longest_streak_days  most days in a row with 10,000+ steps
--   longest_workout_min  longest single workout, in minutes
--   farthest_day_mi      most distance in one day, in miles
--
-- The app works these out from the phone's health data (the same source
-- as challenges) and sends them with submit_personal_records, which keeps
-- whichever is higher. The first time a record is set it's just a
-- starting point; beating it afterwards is a new record, which the app
-- celebrates and friends see in their activity feed (0073).
--
-- Values are capped at what a person can plausibly do in a day, so a
-- glitchy sync can't set a record nobody can beat.
--
-- Run this once, after 0001-0083, in the SQL Editor.

create table public.personal_records (
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('best_day_steps', 'longest_streak_days', 'longest_workout_min', 'farthest_day_mi')),
  value numeric not null check (value > 0),
  achieved_on date not null,
  -- The workout's name, for longest_workout_min.
  detail text check (char_length(detail) <= 80),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);

alter table public.personal_records enable row level security;

-- Same reach as achievements (0072): yours, and your friends'.
create policy "Owners and friends can view personal records"
  on public.personal_records for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.requester_id = auth.uid() and f.recipient_id = personal_records.user_id)
          or (f.recipient_id = auth.uid() and f.requester_id = personal_records.user_id))
    )
  );

-- Every time a record is beaten, for the friend feed. Written only by
-- submit_personal_records.
create table public.personal_record_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  value numeric not null,
  previous_value numeric not null,
  achieved_on date not null,
  created_at timestamptz not null default now()
);

create index personal_record_events_user_created on public.personal_record_events (user_id, created_at desc);

alter table public.personal_record_events enable row level security;
-- No policies: only the functions below read or write it.

-- p_records: [{ "kind": ..., "value": ..., "achieved_on": "YYYY-MM-DD", "detail": ... }, ...]
-- Returns one row per record that changed: its new value, the value it
-- beat (null the first time), and whether it counts as a new record.
create or replace function public.submit_personal_records(p_records jsonb)
returns table (kind text, value numeric, previous_value numeric, is_new_record boolean, achieved_on date, detail text)
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  r jsonb;
  k text;
  v numeric;
  d date;
  det text;
  cap numeric;
  prev public.personal_records;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  if jsonb_typeof(p_records) <> 'array' then
    raise exception 'Expected a list of records.';
  end if;

  for r in select * from jsonb_array_elements(p_records) loop
    k := r->>'kind';
    cap := case k
      when 'best_day_steps' then 100000
      when 'longest_streak_days' then 3660
      when 'longest_workout_min' then 1440
      when 'farthest_day_mi' then 150
      else null
    end;
    continue when cap is null;
    begin
      v := (r->>'value')::numeric;
      d := (r->>'achieved_on')::date;
    exception when others then
      continue;
    end;
    continue when v is null or v <= 0 or v > cap or d is null or d > current_date + 1 or d < date '2015-01-01';
    v := case when k = 'farthest_day_mi' then round(v, 1) else round(v) end;
    det := left(nullif(trim(coalesce(r->>'detail', '')), ''), 80);

    select * into prev from public.personal_records pr where pr.user_id = me and pr.kind = k;
    if prev.user_id is null then
      insert into public.personal_records (user_id, kind, value, achieved_on, detail)
        values (me, k, v, d, det);
      return query select k, v, null::numeric, false, d, det;
    elsif v > prev.value then
      update public.personal_records pr
        set value = v, achieved_on = d, detail = det, updated_at = now()
        where pr.user_id = me and pr.kind = k;
      insert into public.personal_record_events (user_id, kind, value, previous_value, achieved_on)
        values (me, k, v, prev.value, d);
      return query select k, v, prev.value, true, d, det;
    end if;
  end loop;
end;
$$;

revoke execute on function public.submit_personal_records(jsonb) from public, anon;
grant execute on function public.submit_personal_records(jsonb) to authenticated;

-- The friend feed (0073) gains one kind:
--   personal_record  beat one of their records (detail = "kind:value")
create or replace function public.friend_activity_feed(p_limit int default 30)
returns table (
  event_id text,
  user_id uuid,
  kind text,
  detail text,
  occurred_at timestamptz,
  name text,
  initials text,
  frame_id text,
  background_id text,
  icon_id text
)
language sql
stable
security definer
set search_path = public
as $$
  with friends as (
    select case when f.requester_id = auth.uid() then f.recipient_id else f.requester_id end as fid
    from public.friendships f
    where f.status = 'accepted'
      and (f.requester_id = auth.uid() or f.recipient_id = auth.uid())
  ),
  events as (
    select
      'r:' || ae.id::text as event_id,
      ae.user_id,
      case
        when ae.kind = 'steps_result' then 'won_steps'
        when ae.kind = 'tictacgo_result' then 'won_tictacgo'
        when ae.kind = 'hunt_result' and ae.score_points = 40 then 'won_chase_hunter'
        when ae.kind = 'hunt_result' then 'won_chase_escape'
        when ae.kind = 'bingo_result' then 'bingo_blackout'
        else 'streak_survived'
      end as kind,
      null::text as detail,
      ae.created_at as occurred_at
    from public.activity_events ae
    join friends on friends.fid = ae.user_id
    where ae.created_at > now() - interval '14 days'
      and ((ae.kind = 'steps_result' and ae.score_points = 50)
        or (ae.kind = 'tictacgo_result' and ae.score_points = 35)
        or (ae.kind = 'hunt_result' and ae.score_points in (40, 30))
        or (ae.kind = 'bingo_result' and ae.score_points = 40)
        or (ae.kind = 'streak_result' and ae.score_points = 40))
    union all
    select
      'a:' || ua.user_id::text || ':' || ua.achievement_id,
      ua.user_id,
      'achievement',
      a.name,
      ua.earned_at
    from public.user_achievements ua
    join friends on friends.fid = ua.user_id
    join public.achievements a on a.id = ua.achievement_id
    where ua.earned_at > now() - interval '14 days'
    union all
    select
      'p:' || pre.id::text,
      pre.user_id,
      'personal_record',
      pre.kind || ':' || pre.value::text,
      pre.created_at
    from public.personal_record_events pre
    join friends on friends.fid = pre.user_id
    where pre.created_at > now() - interval '14 days'
  )
  select e.event_id, e.user_id, e.kind, e.detail, e.occurred_at,
    p.name, p.initials, p.equipped_frame_id, p.equipped_background_id, p.equipped_icon_id
  from events e
  join public.profiles p on p.id = e.user_id
  where auth.uid() is not null
  order by e.occurred_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 50);
$$;

revoke execute on function public.friend_activity_feed(int) from public, anon;
grant execute on function public.friend_activity_feed(int) to authenticated;
