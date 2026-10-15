-- Hound: goals, and how hard the Hound reminds you about them.
--
-- Goals used to live only on the phone (two sliders in Settings), so
-- nothing on the server knew what anyone was trying to do. Now each goal
-- is a row:
--
--   metric   steps | distance_mi | workouts | workout_minutes
--   period   day | week (weeks start on Monday)
--   target   how many
--   activity for workouts and workout minutes only: which kind counts
--            (null = any workout)
--   label    your own name for it, optional
--
-- The app works out progress from the phone's health data, the same
-- source as challenges. New users get three starter goals from
-- ensure_starter_goals(): 10,000 steps a day, 3 miles a day and 3 workouts
-- a week, or whatever the phone already had in its sliders. It also says
-- whether the account is new (under a week old), so Today can open goal
-- setup for a new account and just offer a "Set your goals" button to
-- everyone else, until hound_settings.goals_set_at says they've done it.
--
-- hound_settings holds how hard to hound (off, gentle, persistent,
-- relentless; no row = gentle) and the last day the phone has scheduled
-- its own reminders for. send-login-reminders, the 9 PM reminder, only
-- sends when the phone hasn't scheduled that day itself, so nobody gets
-- both.
--
-- Run this once, after 0001-0096, in the SQL Editor.

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  metric text not null check (metric in ('steps', 'distance_mi', 'workouts', 'workout_minutes')),
  period text not null check (period in ('day', 'week')),
  target numeric not null check (target > 0 and target <= 1000000),
  activity text check (
    activity is null
    or (metric in ('workouts', 'workout_minutes')
        and activity in ('run', 'walk_hike', 'cycling', 'swim', 'strength', 'yoga_pilates', 'hiit_cardio', 'sports'))
  ),
  label text check (char_length(label) between 1 and 40),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create index goals_user_active on public.goals (user_id) where archived_at is null;

alter table public.goals enable row level security;

create policy "Owners can view their goals"
  on public.goals for select to authenticated
  using (user_id = auth.uid());

create policy "Owners can add goals"
  on public.goals for insert to authenticated
  with check (user_id = auth.uid());

create policy "Owners can change their goals"
  on public.goals for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Owners can delete their goals"
  on public.goals for delete to authenticated
  using (user_id = auth.uid());

revoke all on public.goals from anon;

-- At most 8 goals at a time, so the Today card and the reminders stay
-- short.
create or replace function public.goals_limit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.archived_at is null and (
    select count(*) from public.goals g
    where g.user_id = new.user_id and g.archived_at is null and g.id <> new.id
  ) >= 8 then
    raise exception 'You can have up to 8 goals at a time.';
  end if;
  return new;
end;
$$;

create trigger goals_limit
  before insert or update on public.goals
  for each row execute procedure public.goals_limit();

revoke execute on function public.goals_limit() from public, anon, authenticated;

-- The three starter goals, once per person: does nothing if they have
-- ever had a goal, archived ones included, so removing all your goals
-- doesn't bring them back.
create or replace function public.ensure_starter_goals(p_steps integer, p_distance_mi numeric)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  is_new boolean;
begin
  if me is null then
    return false;
  end if;
  select p.created_at > now() - interval '7 days' into is_new from public.profiles p where p.id = me;
  perform pg_advisory_xact_lock(hashtext('ensure_starter_goals:' || me::text));
  if not exists (select 1 from public.goals where user_id = me) then
    insert into public.goals (user_id, metric, period, target, sort) values
      (me, 'steps', 'day', least(greatest(coalesce(p_steps, 10000), 1000), 100000), 0),
      (me, 'distance_mi', 'day', least(greatest(coalesce(p_distance_mi, 3), 0.5), 100), 1),
      (me, 'workouts', 'week', 3, 2);
  end if;
  return coalesce(is_new, false);
end;
$$;

revoke execute on function public.ensure_starter_goals(integer, numeric) from public, anon;
grant execute on function public.ensure_starter_goals(integer, numeric) to authenticated;

create table public.hound_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  level text not null default 'gentle' check (level in ('off', 'gentle', 'persistent', 'relentless')),
  -- The last local calendar day the phone has scheduled reminders for.
  scheduled_through date,
  -- When this person last set their goals themselves (goal setup on
  -- Today, or the Goals screen). Null until then.
  goals_set_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.hound_settings enable row level security;

create policy "Owners can view their hound settings"
  on public.hound_settings for select to authenticated
  using (user_id = auth.uid());

create policy "Owners can add their hound settings"
  on public.hound_settings for insert to authenticated
  with check (user_id = auth.uid());

create policy "Owners can change their hound settings"
  on public.hound_settings for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.hound_settings from anon;

-- Undo, if needed:
--   drop table public.hound_settings;
--   drop function public.ensure_starter_goals(integer, numeric);
--   drop table public.goals;
--   drop function public.goals_limit();
