-- Persists workouts read from HealthKit/Health Connect (WorkoutSample,
-- via getRecentWorkouts()) — before this, a workout only ever existed
-- on-device, gone the moment the device itself stopped keeping it.
-- Written by recordWorkoutHistory() (src/workouts/supabaseWorkoutHistory.ts)
-- on every Home screen load, same "it's an upsert, re-running it is
-- harmless" reasoning ChallengeDetailScreen's syncFromDevice and the
-- daily_step_totals sync already rely on.
--
-- Keyed by (user_id, source_id) — source_id is the same provider-issued
-- id WorkoutSample.id already carries: HealthKit's own uuid, or Health
-- Connect's record metadata.id (see androidProvider.ts's getRecentWorkouts
-- for why its fallback, for the rare case that id is missing, now has to
-- be deterministic across fetches rather than an array index).
create table public.workout_history (
  user_id uuid not null references public.profiles (id) on delete cascade,
  source_id text not null,
  name text not null,
  occurred_at timestamptz not null,
  source text not null,
  distance_mi numeric(6, 2),
  avg_heart_rate integer,
  duration_min integer,
  synced_at timestamptz not null default now(),
  primary key (user_id, source_id)
);

alter table public.workout_history enable row level security;

-- Own rows only — unlike the steps leaderboard, nothing here needs a
-- cross-user view yet, so there's no security-definer escape hatch to go
-- with it (add one if a future analysis phase ever needs to aggregate
-- across users).
create policy "Users can view their own workout history"
  on public.workout_history for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can record their own workout history"
  on public.workout_history for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Users can update their own workout history"
  on public.workout_history for update
  to authenticated
  using (user_id = auth.uid());

-- Where old rows go instead of being deleted outright — RLS enabled, no
-- policy at all (same "nobody except a security-definer function" shape
-- as the alert guard tables in 0025_challenge_alerts.sql), since nobody
-- ever reads this directly; it exists purely so admin_archive_workout_history
-- below doesn't have to be destructive to solve workout_history's
-- unbounded growth.
create table public.workout_history_archive (
  user_id uuid not null,
  source_id text not null,
  name text not null,
  occurred_at timestamptz not null,
  source text not null,
  distance_mi numeric(6, 2),
  avg_heart_rate integer,
  duration_min integer,
  synced_at timestamptz not null,
  archived_at timestamptz not null default now(),
  primary key (user_id, source_id)
);

alter table public.workout_history_archive enable row level security;

-- Admin-only maintenance: moves workout_history rows older than
-- `older_than_days` (default ~6 months) into the archive table instead
-- of deleting them outright, and reports how many it moved. Same
-- "security-definer + is_admin check" shape admin_user_overview
-- (0023_admin_user_directory.sql) already uses — nothing here is wired
-- to a schedule or a UI button, it's a function an admin calls on
-- demand (e.g. from the SQL editor or supabase.rpc(...)) when
-- workout_history has grown enough to be worth trimming.
create or replace function public.admin_archive_workout_history(older_than_days integer default 180)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  archived_count bigint;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;

  with moved as (
    delete from public.workout_history
    where occurred_at < now() - (older_than_days || ' days')::interval
    returning *
  )
  insert into public.workout_history_archive
    (user_id, source_id, name, occurred_at, source, distance_mi, avg_heart_rate, duration_min, synced_at)
  select user_id, source_id, name, occurred_at, source, distance_mi, avg_heart_rate, duration_min, synced_at
  from moved;

  get diagnostics archived_count = row_count;
  return archived_count;
end;
$$;

grant execute on function public.admin_archive_workout_history(integer) to authenticated;
