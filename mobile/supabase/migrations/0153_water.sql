-- Hound: the water tracker (the "Water tracker: design" doc, phase 1).
--
-- A member sets a daily water goal and logs glasses with a tap. Water
-- stands beside the goals rather than inside them: it pays no Bones and
-- never touches the goal day or its streak, so tapping can't be farmed.
--
--   water_goals   one row per member who has a water goal. Kept apart
--                 from goals on purpose: an older app reads every goals
--                 row, scores a metric it doesn't know as never done, and
--                 would stop paying that member's goal days.
--   water_log     each glass logged in Hound, by the member's own local
--                 day (the phone says which day it is, like goal days).
--                 log_water adds one, capped at 10 L a day; the member
--                 deletes their own to undo.
--   water_days    days the member met their water goal. The phone claims
--                 them (claim_water_day), because water other apps put in
--                 Apple Health counts too and only the phone can read it.
--                 They earn three badges and nothing else, so trusting the
--                 phone costs nothing.
--
-- Also: the three water badges (0 Bones), and a 'water' kind for
-- Accountability checklist items, which tick themselves on days the
-- member's water goal is met.
--
-- Run this once, after 0001-0152, in the SQL Editor, before publishing
-- the app update that goes with it.

-- ── Goal ─────────────────────────────────────────────────────────────

create table public.water_goals (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  -- 8 US cups is 1,893 ml.
  target_ml integer not null default 1893 check (target_ml between 500 and 6000),
  -- What one tap adds: a cup (237 ml), a bottle (500 ml), or your own.
  glass_ml integer not null default 237 check (glass_ml between 30 and 2000),
  units text not null default 'cups' check (units in ('cups', 'ml')),
  -- A reminder every 2 hours, 10 AM to 6 PM, scheduled on the phone.
  sip_reminders boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.water_goals enable row level security;

create policy "Owners can view their water goal"
  on public.water_goals for select to authenticated
  using (user_id = auth.uid());

create policy "Owners can add their water goal"
  on public.water_goals for insert to authenticated
  with check (user_id = auth.uid());

create policy "Owners can change their water goal"
  on public.water_goals for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Owners can remove their water goal"
  on public.water_goals for delete to authenticated
  using (user_id = auth.uid());

-- ── Log ──────────────────────────────────────────────────────────────

create table public.water_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  ml integer not null check (ml between 1 and 2000),
  logged_at timestamptz not null default now()
);

create index water_log_user_day on public.water_log (user_id, day);

alter table public.water_log enable row level security;

create policy "Owners can view their water log"
  on public.water_log for select to authenticated
  using (user_id = auth.uid());

-- Undo, and Remove in the water sheet.
create policy "Owners can remove from their water log"
  on public.water_log for delete to authenticated
  using (user_id = auth.uid());

-- One glass on the member's local day. The day may be a day either side
-- of the server's (time zones), or up to two days back (a phone that
-- logged offline and sent it late).
create or replace function public.log_water(p_day date, p_ml integer)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  so_far integer;
  new_id uuid;
begin
  if caller is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_ml is null or p_ml < 1 or p_ml > 2000 then
    raise exception 'A glass is 1 to 2,000 ml.';
  end if;
  if p_day is null or p_day < current_date - 2 or p_day > current_date + 1 then
    raise exception 'Water can only be logged for today.';
  end if;

  -- One at a time per member, so two quick taps can't both slip under
  -- the cap.
  perform pg_advisory_xact_lock(hashtext('water_log:' || caller::text));
  select coalesce(sum(ml), 0) into so_far from public.water_log where user_id = caller and day = p_day;
  if so_far + p_ml > 10000 then
    raise exception 'That''s more than 10 litres today. Remove an entry if one was a mistake.';
  end if;

  insert into public.water_log (user_id, day, ml) values (caller, p_day, p_ml) returning id into new_id;
  return new_id;
end;
$$;

revoke execute on function public.log_water(date, integer) from public, anon;
grant execute on function public.log_water(date, integer) to authenticated;

-- ── Water days and badges ────────────────────────────────────────────

create table public.water_days (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.water_days enable row level security;

create policy "Owners can view their water days"
  on public.water_days for select to authenticated
  using (user_id = auth.uid());

-- True when the day is new. Only within the last week, and only with a
-- water goal.
create or replace function public.claim_water_day(p_day date)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  added integer;
begin
  if caller is null then
    raise exception 'Sign in to do that.';
  end if;
  if not exists (select 1 from public.water_goals where user_id = caller) then
    raise exception 'Set a water goal first.';
  end if;
  if p_day is null or p_day < current_date - 7 or p_day > current_date + 1 then
    raise exception 'Only the last week''s water days can be counted.';
  end if;
  insert into public.water_days (user_id, day) values (caller, p_day) on conflict do nothing;
  get diagnostics added = row_count;
  return added > 0;
end;
$$;

revoke execute on function public.claim_water_day(date) from public, anon;
grant execute on function public.claim_water_day(date) to authenticated;

-- The longest run of water days in a row.
create or replace function public.water_best_run(p_user uuid)
returns integer
language sql
stable
security definer set search_path = public
as $$
  select coalesce(max(n), 0)::integer from (
    select count(*) as n
    from (select day, day - (row_number() over (order by day))::integer as grp
          from public.water_days where user_id = p_user) s
    group by grp
  ) runs;
$$;

revoke execute on function public.water_best_run(uuid) from public, anon, authenticated;

-- A badge may now pay nothing: the water ones don't.
alter table public.achievements drop constraint achievements_bones_check;
alter table public.achievements add constraint achievements_bones_check check (bones >= 0);

insert into public.achievements (id, name, description, bones, sort_order) values
  ('water_first', 'First Sip', 'Meet your water goal for a day.', 0, 24),
  ('water_7', 'Well Watered', 'Meet your water goal 7 days in a row.', 0, 25),
  ('water_30', 'Watering Hole', 'Meet your water goal on 30 days.', 0, 26)
on conflict (id) do nothing;

-- 0151's check_achievements, with the water badges.
create or replace function public.check_achievements()
returns table (achievement_id text, name text, bones int)
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  my_xp int;
  my_streak int;
  finished int;
  counted int;
  friend_count int;
  best_day int;
  week_steps int;
  water_count int;
  water_run int;
  total_bones int;
  new_ids text[];
begin
  if caller is null then
    raise exception 'Sign in to do that.';
  end if;

  select p.xp_total, p.daily_bonus_streak into my_xp, my_streak
    from public.profiles p where p.id = caller
    for update;
  if not found then
    raise exception 'No profile for this account.';
  end if;

  select count(distinct ae.challenge_id) into finished
    from public.activity_events ae
    where ae.user_id = caller
      and ae.challenge_id is not null
      and (ae.kind like '%\_result' or ae.kind = 'participation');

  counted := public.milestone_finishes(caller);

  select count(*) into friend_count
    from public.friendships f
    where f.status = 'accepted' and (f.requester_id = caller or f.recipient_id = caller);

  select coalesce(max(d.steps), 0) into best_day
    from public.daily_step_totals d where d.user_id = caller;

  select coalesce(sum(d.steps), 0) into week_steps
    from public.daily_step_totals d
    where d.user_id = caller and d.day > (now() at time zone 'utc')::date - 7;

  select count(*) into water_count from public.water_days w where w.user_id = caller;
  water_run := case when water_count >= 7 then public.water_best_run(caller) else 0 end;

  select coalesce(array_agg(a.id), '{}') into new_ids
  from public.achievements a
  where not exists (
      select 1 from public.user_achievements ua where ua.user_id = caller and ua.achievement_id = a.id
    )
    and case a.id
      when 'first_finish' then finished >= 1
      when 'ten_finishes' then finished >= 10
      when 'finishes_25' then counted >= 25
      when 'finishes_50' then counted >= 50
      when 'finishes_100' then counted >= 100
      when 'first_win' then exists (
        select 1 from public.activity_events ae
        where ae.user_id = caller
          and ((ae.kind = 'steps_result' and ae.score_points = 50)
            or (ae.kind = 'tictacgo_result' and ae.score_points = 35)
            or (ae.kind = 'hunt_result' and ae.score_points in (40, 30)))
      )
      when 'blackout' then exists (
        select 1 from public.activity_events ae
        where ae.user_id = caller and ae.kind = 'bingo_result' and ae.score_points = 40
      )
      when 'unbroken' then exists (
        select 1 from public.activity_events ae
        where ae.user_id = caller and ae.kind = 'streak_result' and ae.score_points = 40
      )
      when 'first_friend' then friend_count >= 1
      when 'five_friends' then friend_count >= 5
      when 'steps_10k_day' then best_day >= 10000
      when 'steps_100k_week' then week_steps >= 100000
      when 'streak_7' then coalesce(my_streak, 0) >= 7
      when 'streak_30' then coalesce(my_streak, 0) >= 30
      when 'level_5' then public.level_for_xp(coalesce(my_xp, 0)) >= 5
      when 'level_10' then public.level_for_xp(coalesce(my_xp, 0)) >= 10
      when 'water_first' then water_count >= 1
      when 'water_7' then water_run >= 7
      when 'water_30' then water_count >= 30
      else false
    end;

  if cardinality(new_ids) = 0 then
    return;
  end if;

  insert into public.user_achievements (user_id, achievement_id)
    select caller, unnest(new_ids)
    on conflict do nothing;

  insert into public.activity_events (user_id, kind, score_points, xp_points, bones_points)
    select caller, 'achievement', 0, 0, a.bones
    from public.achievements a where a.id = any (new_ids);

  select coalesce(sum(a.bones), 0) into total_bones
    from public.achievements a where a.id = any (new_ids);
  if total_bones > 0 then
    update public.profiles set bones_balance = bones_balance + total_bones where id = caller;
  end if;

  return query
    select a.id, a.name, a.bones
    from public.achievements a where a.id = any (new_ids)
    order by a.sort_order;
end;
$$;

revoke execute on function public.check_achievements() from public, anon;
grant execute on function public.check_achievements() to authenticated;

-- ── Checklist items that tick on water days ──────────────────────────

alter table public.checklist_items drop constraint checklist_items_kind_check;
alter table public.checklist_items add constraint checklist_items_kind_check
  check (kind in ('manual', 'workout', 'mindfulness', 'steps', 'water'));
