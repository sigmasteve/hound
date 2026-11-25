-- 0270: Move points (Steve, 26 Nov 2026: engage people without a watch, who
-- go to the gym or just move around; "fitness with friends", and strength
-- training is a must). Mock-ups: claude.ai/artifact/LXZQp7xBLLJdXTGicvTojm.
--
-- One currency for every kind of movement: 1 Move point = 1 step's worth.
-- Steps count as they are; a workout earns its minutes × its activity's
-- rate (points a minute, Admin → Bones → Move points; starting at
-- 100 × MET ÷ 3.5, so a brisk walk earns what its steps do). Walking,
-- running and hiking earn nothing extra: their steps already count.
--
-- Everything comes from workout_history, where workouts already live:
--   - from a watch or Health (any other source): in full;
--   - logged by hand ('manual', 0204's Log a workout, which now has more
--     activities): up to 2 hours a day (move_config.hand_cap_min);
--   - timed in Hound ('hound', new): a guided routine or a strength log,
--     started and finished on the server, so the minutes can't be more
--     than really went by. In full, unless a watch workout covers the same
--     time (then the watch's counts and this one doesn't, so nothing is
--     counted twice).
-- Each workout keeps the activity and rate it was recorded with
-- (move_activity, move_rate), so a rate change applies to what's
-- recorded after it.
--
-- Strength: each person sets a goal of 1 to 5 sessions a week (2 to
-- start); a week counts toward the streak when it's reached. A strength
-- log's sets are kept, and a set past your best for that exercise is a new
-- best (a PR).
--
-- Challenges: a new Most steps challenge can count Move points instead
-- (challenges.counts = 'move'). Its progress_snapshots rows keep the
-- phone's steps in raw_steps, the day's Move points in move_pts, and
-- steps = both, so the leaderboard, results and prizes need no change. A
-- workout recorded later brings that day's rows up to date.
--
-- Admin: admin_move_overview (Overview → Fitness → Move points) and
-- admin_set_move_config (the rates and the cap, Bones → Move points).
--
-- Run this once, after 0001-0269, in the SQL Editor.

-- ── Rates and settings ──

create table public.move_rates (
  activity text primary key,
  label text not null,
  per_min int not null check (per_min between 0 and 1000),
  -- Matched against a workout's name (ilike), lowest sort first.
  patterns text[] not null default '{}',
  sort int not null,
  updated_at timestamptz not null default now()
);
insert into public.move_rates (activity, label, per_min, patterns, sort) values
  ('steps', 'Walking, running, hiking', 0, '{%walk%,%run%,%hik%,%golf%}', 10),
  ('stretching', 'Stretching, mobility', 65, '{%flexib%,%stretch%,%mobility%,%cooldown%}', 20),
  ('yoga', 'Yoga', 70, '{%yoga%}', 30),
  ('pilates', 'Pilates', 85, '{%pilates%}', 40),
  ('housework', 'Housework, yard work', 100, '{%housework%,%yard%,%garden%}', 50),
  ('strength_heavy', 'Strength, heavy or circuits', 170, '{%circuit%,%crossfit%,%cross training%}', 55),
  ('strength_light', 'Strength, light or bodyweight', 100, '{%strength%,%core training%}', 60),
  ('pickleball', 'Pickleball', 115, '{%pickleball%}', 70),
  ('dance', 'Dance, Zumba', 145, '{%dance%,%zumba%}', 80),
  ('elliptical', 'Elliptical', 145, '{%elliptical%}', 90),
  ('swim', 'Swimming', 165, '{%swim%}', 100),
  ('basketball', 'Basketball', 185, '{%basketball%}', 110),
  ('spin', 'Spin class', 245, '{%spin%}', 115),
  ('cycling', 'Cycling', 195, '{%cycl%,%bik%}', 120),
  ('rowing', 'Rowing machine', 200, '{%rowing%}', 130),
  ('tennis_soccer', 'Tennis, soccer', 205, '{%tennis%,%soccer%}', 140),
  ('hiit', 'HIIT, bootcamp', 230, '{%high intensity%,%hiit%,%bootcamp%}', 150),
  ('other', 'Anything else', 100, '{}', 1000);
alter table public.move_rates enable row level security;
create policy "Anyone signed in can read the Move points rates"
  on public.move_rates for select to authenticated using (true);
revoke all on public.move_rates from anon;
revoke insert, update, delete on public.move_rates from authenticated;

create table public.move_config (
  id boolean primary key default true,
  constraint move_config_singleton check (id),
  -- Minutes a day of workouts logged by hand that count.
  hand_cap_min int not null default 120 check (hand_cap_min between 0 and 1440),
  updated_at timestamptz not null default now()
);
insert into public.move_config (id) values (true);
alter table public.move_config enable row level security;
create policy "Anyone signed in can read the Move points settings"
  on public.move_config for select to authenticated using (true);
revoke all on public.move_config from anon;
revoke insert, update, delete on public.move_config from authenticated;

-- ── Workouts carry their activity and rate ──

alter table public.workout_history
  add column if not exists move_activity text,
  add column if not exists move_rate int;

create or replace function public.move_activity_for(p_name text)
returns text
language sql
stable
security definer set search_path = public
as $$
  select coalesce((
    select r.activity from public.move_rates r
    where r.activity <> 'other' and exists (select 1 from unnest(r.patterns) pt where p_name ilike pt)
    order by r.sort limit 1), 'other');
$$;
revoke execute on function public.move_activity_for(text) from public, anon, authenticated;

create or replace function public.move_rate_of(p_activity text)
returns int
language sql
stable
security definer set search_path = public
as $$
  select coalesce((select r.per_min from public.move_rates r where r.activity = p_activity),
                  (select r.per_min from public.move_rates r where r.activity = 'other'), 100);
$$;
revoke execute on function public.move_rate_of(text) from public, anon, authenticated;

create or replace function public.move_tag_workout()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.name is distinct from old.name and new.source <> 'hound' then
    new.move_activity := null;
    new.move_rate := null;
  end if;
  if new.move_activity is null then
    new.move_activity := public.move_activity_for(new.name);
  end if;
  if new.move_rate is null then
    new.move_rate := public.move_rate_of(new.move_activity);
  end if;
  return new;
end;
$$;
revoke execute on function public.move_tag_workout() from public, anon, authenticated;

drop trigger if exists move_tag_workout on public.workout_history;
create trigger move_tag_workout
  before insert or update of name on public.workout_history
  for each row execute procedure public.move_tag_workout();

-- The last 60 days get their activity and today's rate.
update public.workout_history w
  set move_activity = public.move_activity_for(w.name),
      move_rate = public.move_rate_of(public.move_activity_for(w.name))
  where w.move_activity is null and w.occurred_at > now() - interval '60 days';

-- Clients can't write Hound's own timed workouts either (only
-- move_session_finish can), as with 'manual' (0204).
drop policy if exists "Users can record their own workout history" on public.workout_history;
drop policy if exists "Users can update their own workout history" on public.workout_history;
create policy "Users can record their own workout history"
  on public.workout_history for insert
  to authenticated
  with check (user_id = auth.uid() and source not in ('manual', 'hound'));
create policy "Users can update their own workout history"
  on public.workout_history for update
  to authenticated
  using (user_id = auth.uid() and source not in ('manual', 'hound'))
  with check (user_id = auth.uid() and source not in ('manual', 'hound'));

-- Log a workout (0204) gets the new activities.
create or replace function public.workout_log_name(p_type text)
returns text
language sql
immutable
as $$
  select case p_type
    when 'strength' then 'Traditional Strength Training'
    when 'walk' then 'Walking'
    when 'run' then 'Running'
    when 'cycle' then 'Cycling'
    when 'yoga' then 'Yoga'
    when 'hiit' then 'High Intensity Interval Training'
    when 'basketball' then 'Basketball'
    when 'soccer' then 'Soccer'
    when 'golf' then 'Golf'
    when 'tennis' then 'Tennis'
    when 'swim' then 'Swimming'
    when 'pilates' then 'Pilates'
    when 'stretching' then 'Flexibility'
    when 'dance' then 'Dance'
    when 'elliptical' then 'Elliptical'
    when 'rowing' then 'Rowing'
    when 'pickleball' then 'Pickleball'
    when 'housework' then 'Housework'
    when 'spin' then 'Spin Class'
    when 'other' then 'Other'
  end;
$$;
revoke execute on function public.workout_log_name(text) from public, anon, authenticated;

-- ── A day's Move points ──

-- Every workout on someone's local day and what it earned: in full from a
-- watch or Hound (a Hound one that a watch workout covers earns nothing),
-- by hand up to the day's cap, in order.
create or replace function public.move_day_items(p_user uuid, p_day date)
returns table (
  source_id text, name text, source text, activity text, occurred_at timestamptz,
  minutes int, counted_min int, rate int, pts int, kind text
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  tz text := public.workout_log_tz(p_user);
  cap int := coalesce((select c.hand_cap_min from public.move_config c where c.id), 120);
  used int := 0;
  w record;
  m int;
  c int;
  covered boolean;
begin
  for w in
    select x.* from public.workout_history x
    where x.user_id = p_user and (x.occurred_at at time zone tz)::date = p_day
    order by x.occurred_at, x.source_id
  loop
    m := greatest(coalesce(case when w.source = 'manual' then w.logged_min end, w.duration_min, 0), 0);
    covered := false;
    if w.source = 'manual' then
      c := least(m, greatest(cap - used, 0));
      used := used + m;
    elsif w.source = 'hound' then
      covered := exists (
        select 1 from public.workout_history d
        where d.user_id = p_user and d.source not in ('manual', 'hound')
          and d.occurred_at < w.occurred_at + make_interval(mins => greatest(m, 1))
          and d.occurred_at + make_interval(mins => greatest(coalesce(d.duration_min, 0), 1)) > w.occurred_at);
      c := case when covered then 0 else m end;
    else
      c := m;
    end if;
    source_id := w.source_id;
    name := w.name;
    source := w.source;
    activity := coalesce(w.move_activity, public.move_activity_for(w.name));
    occurred_at := w.occurred_at;
    minutes := m;
    counted_min := c;
    rate := coalesce(w.move_rate, public.move_rate_of(activity));
    pts := c * rate;
    kind := case when w.source = 'manual' then 'hand' when w.source = 'hound' then case when covered then 'covered' else 'hound' end else 'device' end;
    return next;
  end loop;
end;
$$;
revoke execute on function public.move_day_items(uuid, date) from public, anon, authenticated;

create or replace function public.move_points_day(p_user uuid, p_day date)
returns int
language sql
stable
security definer set search_path = public
as $$ select coalesce(sum(i.pts), 0)::int from public.move_day_items(p_user, p_day) i; $$;
revoke execute on function public.move_points_day(uuid, date) from public, anon, authenticated;

-- ── Move points challenges ──

alter table public.challenges
  add column if not exists counts text not null default 'steps' check (counts in ('steps', 'move'));
alter table public.progress_snapshots
  add column if not exists raw_steps int,
  add column if not exists move_pts int not null default 0;

-- A Move points challenge's daily row: the phone writes steps (kept as
-- raw_steps); the server adds the day's Move points. Written again from
-- a workout's trigger (depth > 1), it keeps raw_steps and refreshes the
-- points.
create or replace function public.move_snapshot()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.challenges c where c.id = new.challenge_id and c.counts = 'move') then
    return new;
  end if;
  if pg_trigger_depth() = 1 then
    new.raw_steps := new.steps;
  end if;
  new.move_pts := public.move_points_day(new.user_id, new.day);
  new.steps := coalesce(new.raw_steps, 0) + new.move_pts;
  return new;
end;
$$;
revoke execute on function public.move_snapshot() from public, anon, authenticated;

drop trigger if exists move_snapshot on public.progress_snapshots;
create trigger move_snapshot
  before insert or update on public.progress_snapshots
  for each row execute procedure public.move_snapshot();

-- A workout recorded, changed or removed brings that day's rows in the
-- person's Move points challenges up to date (adding the day's row if the
-- phone hasn't written it yet).
create or replace function public.move_refresh_day(p_user uuid, p_day date)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  tz text := public.workout_log_tz(p_user);
begin
  insert into public.progress_snapshots (challenge_id, user_id, day, steps, distance_mi)
  select c.id, p_user, p_day, 0, 0
  from public.challenges c
  join public.challenge_participants cp on cp.challenge_id = c.id and cp.user_id = p_user
  where c.counts = 'move'
    and p_day >= (c.starts_at at time zone tz)::date
    and p_day <= ((c.ends_at - interval '1 second') at time zone tz)::date
  on conflict (challenge_id, user_id, day) do update set move_pts = public.progress_snapshots.move_pts;
end;
$$;
revoke execute on function public.move_refresh_day(uuid, date) from public, anon, authenticated;

create or replace function public.move_workout_changed()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  tz text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    tz := public.workout_log_tz(old.user_id);
    perform public.move_refresh_day(old.user_id, (old.occurred_at at time zone tz)::date);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    tz := public.workout_log_tz(new.user_id);
    if tg_op = 'INSERT' or (new.occurred_at at time zone tz)::date <> (old.occurred_at at time zone tz)::date or new.user_id <> old.user_id then
      perform public.move_refresh_day(new.user_id, (new.occurred_at at time zone tz)::date);
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function public.move_workout_changed() from public, anon, authenticated;

drop trigger if exists move_workout_changed on public.workout_history;
create trigger move_workout_changed
  after insert or update or delete on public.workout_history
  for each row execute procedure public.move_workout_changed();

-- ── Timed in Hound: guided routines and strength logs ──

create table public.move_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('routine', 'strength')),
  -- A guided routine's id, or a strength log's template.
  ref text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  minutes int,
  activity text,
  source_id text,
  pts int,
  cancelled boolean not null default false
);
create index move_sessions_user on public.move_sessions (user_id, started_at desc);
alter table public.move_sessions enable row level security;
create policy "Owners can view their Move sessions"
  on public.move_sessions for select to authenticated using (user_id = auth.uid());
revoke all on public.move_sessions from anon;
revoke insert, update, delete on public.move_sessions from authenticated;

create table public.move_sets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.move_sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  exercise text not null check (length(exercise) between 1 and 60),
  set_no int not null check (set_no between 1 and 20),
  weight_lb numeric(6, 1) check (weight_lb is null or weight_lb between 0 and 2000),
  reps int not null check (reps between 1 and 500),
  is_pr boolean not null default false,
  created_at timestamptz not null default now()
);
create index move_sets_user_ex on public.move_sets (user_id, lower(exercise));
alter table public.move_sets enable row level security;
create policy "Owners can view their sets"
  on public.move_sets for select to authenticated using (user_id = auth.uid());
revoke all on public.move_sets from anon;
revoke insert, update, delete on public.move_sets from authenticated;

create table public.move_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  strength_target int not null default 2 check (strength_target between 1 and 5),
  updated_at timestamptz not null default now()
);
alter table public.move_profiles enable row level security;
create policy "Owners can view their Move profile"
  on public.move_profiles for select to authenticated using (user_id = auth.uid());
revoke all on public.move_profiles from anon;
revoke insert, update, delete on public.move_profiles from authenticated;

-- Start timing. One at a time: starting again closes an old one.
create or replace function public.move_session_start(p_kind text, p_ref text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  s public.move_sessions;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_kind not in ('routine', 'strength') then
    raise exception 'A routine or a strength log.';
  end if;
  if p_ref is null or length(trim(p_ref)) not between 1 and 40 then
    raise exception 'Pick a routine or a template.';
  end if;
  update public.move_sessions set cancelled = true
    where user_id = me and finished_at is null and not cancelled;
  insert into public.move_sessions (user_id, kind, ref) values (me, p_kind, trim(p_ref)) returning * into s;
  return jsonb_build_object('id', s.id, 'started_at', s.started_at);
end;
$$;
revoke execute on function public.move_session_start(text, text) from public, anon;
grant execute on function public.move_session_start(text, text) to authenticated;

create or replace function public.move_session_cancel(p_id uuid)
returns void
language sql
security definer set search_path = public
as $$
  update public.move_sessions set cancelled = true
  where id = p_id and user_id = auth.uid() and finished_at is null;
$$;
revoke execute on function public.move_session_cancel(uuid) from public, anon;
grant execute on function public.move_session_cancel(uuid) to authenticated;

-- Strength days in an ISO week (Monday p_monday), local days.
create or replace function public.move_strength_days(p_user uuid, p_monday date)
returns int
language sql
stable
security definer set search_path = public
as $$
  select count(distinct (w.occurred_at at time zone public.workout_log_tz(p_user))::date)::int
  from public.workout_history w
  where w.user_id = p_user
    and coalesce(w.move_activity, public.move_activity_for(w.name)) in ('strength_light', 'strength_heavy')
    and (w.occurred_at at time zone public.workout_log_tz(p_user))::date between p_monday and p_monday + 6;
$$;
revoke execute on function public.move_strength_days(uuid, date) from public, anon, authenticated;

-- Your strength goal, this week and the week streak (weeks in a row that
-- reached the goal; this week joins once it's reached).
create or replace function public.move_strength_json(p_user uuid, p_day date)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  target int := coalesce((select mp.strength_target from public.move_profiles mp where mp.user_id = p_user), 2);
  mon date := p_day - (extract(isodow from p_day)::int - 1);
  this_week int := public.move_strength_days(p_user, mon);
  streak int := 0;
  k int := 1;
  weeks jsonb := '[]'::jsonb;
begin
  while k <= 104 loop
    exit when public.move_strength_days(p_user, mon - 7 * k) < target;
    streak := streak + 1;
    k := k + 1;
  end loop;
  if this_week >= target then
    streak := streak + 1;
  end if;
  for k in reverse 5..1 loop
    weeks := weeks || jsonb_build_object('monday', mon - 7 * k, 'days', public.move_strength_days(p_user, mon - 7 * k));
  end loop;
  weeks := weeks || jsonb_build_object('monday', mon, 'days', this_week);
  return jsonb_build_object('target', target, 'this_week', this_week, 'streak', streak, 'weeks', weeks,
    'set', exists (select 1 from public.move_profiles mp where mp.user_id = p_user));
end;
$$;
revoke execute on function public.move_strength_json(uuid, date) from public, anon, authenticated;

create or replace function public.move_set_strength_target(p_target int, p_local_date date)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_target is null or p_target not between 1 and 5 then
    raise exception 'Pick 1 to 5 a week.';
  end if;
  insert into public.move_profiles (user_id, strength_target) values (me, p_target)
    on conflict (user_id) do update set strength_target = excluded.strength_target, updated_at = now();
  return public.move_strength_json(me, p_local_date);
end;
$$;
revoke execute on function public.move_set_strength_target(int, date) from public, anon;
grant execute on function public.move_set_strength_target(int, date) to authenticated;

-- Finish timing. The minutes are the ones asked for, but never more than
-- really went by since the start. A strength log sends its sets
-- ([{exercise, set_no, weight_lb, reps}]); a set past your best for that
-- exercise (heavier, or as heavy with more reps) is a new best.
create or replace function public.move_session_finish(p_id uuid, p_minutes int, p_hard boolean, p_sets jsonb, p_local_date date)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  s public.move_sessions;
  elapsed int;
  m int;
  act text;
  sid text;
  st jsonb;
  ex text;
  wt numeric;
  rp int;
  best_w numeric;
  best_r int;
  prs jsonb := '[]'::jsonb;
  is_pr boolean;
  v_name text;
  got int;
begin
  select * into s from public.move_sessions x where x.id = p_id and x.user_id = me for update;
  if s.id is null then
    raise exception 'That session isn''t yours.';
  end if;
  if s.finished_at is not null or s.cancelled then
    raise exception 'That session is closed.';
  end if;
  elapsed := ceil(extract(epoch from (now() - s.started_at)) / 60.0)::int;
  if elapsed > 240 then
    update public.move_sessions set cancelled = true where id = s.id;
    raise exception 'That session ran over 4 hours, so it wasn''t saved. Log it by hand instead.';
  end if;
  m := least(greatest(coalesce(p_minutes, elapsed), 1), greatest(elapsed, 1));
  -- A stretch routine (ref 'stretch…') is stretching; any other routine,
  -- or a strength log, is strength (heavy if you said it was hard).
  act := case when s.kind = 'routine' and s.ref like 'stretch%' then 'stretching'
              when s.kind = 'strength' and coalesce(p_hard, false) then 'strength_heavy'
              else 'strength_light' end;
  v_name := case when act = 'stretching' then 'Flexibility'
                 when s.kind = 'routine' then 'Functional Strength Training'
                 else 'Traditional Strength Training' end;
  sid := 'hound:' || s.id::text;

  insert into public.workout_history (user_id, source_id, name, occurred_at, source, duration_min, logged_min, move_activity, move_rate)
    values (me, sid, v_name, now() - make_interval(mins => m), 'hound', m, m, act, public.move_rate_of(act));

  if s.kind = 'strength' and p_sets is not null and jsonb_typeof(p_sets) = 'array' then
    if jsonb_array_length(p_sets) > 80 then
      raise exception 'That''s a lot of sets. 80 at most.';
    end if;
    for st in select * from jsonb_array_elements(p_sets) loop
      ex := trim(coalesce(st ->> 'exercise', ''));
      continue when ex = '' or (st ->> 'reps') is null;
      wt := nullif((st ->> 'weight_lb')::numeric, 0);
      rp := (st ->> 'reps')::int;
      select max(x.weight_lb) into best_w from public.move_sets x where x.user_id = me and lower(x.exercise) = lower(ex);
      select max(x.reps) into best_r from public.move_sets x
        where x.user_id = me and lower(x.exercise) = lower(ex) and x.weight_lb is not distinct from coalesce(best_w, wt);
      is_pr := exists (select 1 from public.move_sets x where x.user_id = me and lower(x.exercise) = lower(ex))
        and ((wt is not null and (best_w is null or wt > best_w))
          or (wt is not distinct from best_w and rp > coalesce(best_r, 0)));
      insert into public.move_sets (session_id, user_id, exercise, set_no, weight_lb, reps, is_pr)
        values (s.id, me, ex, coalesce((st ->> 'set_no')::int, 1), wt, rp, is_pr);
      if is_pr then
        prs := prs || jsonb_build_object('exercise', ex, 'weight_lb', wt, 'reps', rp, 'prev_weight_lb', best_w, 'prev_reps', best_r);
      end if;
    end loop;
  end if;

  select i.pts into got from public.move_day_items(me, (now() at time zone public.workout_log_tz(me))::date) i where i.source_id = sid;
  update public.move_sessions set finished_at = now(), minutes = m, activity = act, source_id = sid, pts = coalesce(got, 0) where id = s.id;
  return jsonb_build_object(
    'minutes', m, 'pts', coalesce(got, 0), 'activity', act, 'prs', prs,
    'today', public.move_points_day(me, (now() at time zone public.workout_log_tz(me))::date),
    'strength', public.move_strength_json(me, coalesce(p_local_date, (now() at time zone public.workout_log_tz(me))::date)));
end;
$$;
revoke execute on function public.move_session_finish(uuid, int, boolean, jsonb, date) from public, anon;
grant execute on function public.move_session_finish(uuid, int, boolean, jsonb, date) to authenticated;

-- Your last and best for each exercise you've logged, for "Last time".
create or replace function public.move_exercise_history()
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (
    select lower(x.exercise) as k, jsonb_build_object(
      'exercise', (array_agg(x.exercise order by x.created_at desc))[1],
      'last_weight_lb', (array_agg(x.weight_lb order by x.created_at desc, x.set_no desc))[1],
      'last_reps', (array_agg(x.reps order by x.created_at desc, x.set_no desc))[1],
      'best_weight_lb', max(x.weight_lb)) as v
    from public.move_sets x where x.user_id = auth.uid()
    group by lower(x.exercise)) z;
$$;
revoke execute on function public.move_exercise_history() from public, anon;
grant execute on function public.move_exercise_history() to authenticated;

-- ── Mine ──

create or replace function public.my_move(p_local_date date)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  cap int := (select c.hand_cap_min from public.move_config c where c.id);
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  return jsonb_build_object(
    'day', p_local_date,
    'pts', public.move_points_day(me, p_local_date),
    'hand_cap_min', cap,
    'hand_min', (select coalesce(sum(i.minutes), 0) from public.move_day_items(me, p_local_date) i where i.kind = 'hand'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source_id', i.source_id, 'name', i.name, 'activity', i.activity, 'kind', i.kind,
        'occurred_at', i.occurred_at, 'minutes', i.minutes, 'counted_min', i.counted_min, 'rate', i.rate, 'pts', i.pts,
        'prs', (select count(*) from public.move_sets x join public.move_sessions ms on ms.id = x.session_id
                where ms.source_id = i.source_id and x.is_pr),
        'ref', (select ms.ref from public.move_sessions ms where ms.source_id = i.source_id))
        order by i.occurred_at)
      from public.move_day_items(me, p_local_date) i), '[]'::jsonb),
    'strength', public.move_strength_json(me, p_local_date));
end;
$$;
revoke execute on function public.my_move(date) from public, anon;
grant execute on function public.my_move(date) to authenticated;

-- ── Admin ──

create or replace function public.admin_move_overview()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  res jsonb;
begin
  if not exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin) then
    raise exception 'not authorized';
  end if;
  with w7 as (
    select w.* from public.workout_history w
    where w.occurred_at > now() - interval '7 days' and coalesce(w.move_rate, 0) > 0
  ), s as (
    select * from public.move_sessions where finished_at is not null
  )
  select jsonb_build_object(
    'timed_people', (select count(distinct user_id) from s),
    'timed_people_7d', (select count(distinct user_id) from s where finished_at > now() - interval '7 days'),
    'routines_7d', (select count(*) from s where kind = 'routine' and finished_at > now() - interval '7 days'),
    'strength_logs_7d', (select count(*) from s where kind = 'strength' and finished_at > now() - interval '7 days'),
    'top_routines', coalesce((select jsonb_agg(jsonb_build_object('ref', ref, 'n', n) order by n desc)
      from (select ref, count(*) n from s where kind = 'routine' group by ref order by 2 desc limit 5) z), '[]'::jsonb),
    'prs_7d', (select count(*) from public.move_sets where is_pr and created_at > now() - interval '7 days'),
    'people_with_activity_7d', (select count(distinct user_id) from w7),
    'minutes_7d', jsonb_build_object(
      'device', (select coalesce(sum(duration_min), 0) from w7 where source not in ('manual', 'hound')),
      'hand', (select coalesce(sum(coalesce(logged_min, duration_min)), 0) from w7 where source = 'manual'),
      'hound', (select coalesce(sum(duration_min), 0) from w7 where source = 'hound')),
    'by_activity_7d', coalesce((select jsonb_object_agg(move_activity, n)
      from (select move_activity, count(*) n from w7 group by move_activity) z), '{}'::jsonb),
    'goals', coalesce((select jsonb_object_agg(strength_target, n)
      from (select strength_target, count(*) n from public.move_profiles group by strength_target) z), '{}'::jsonb),
    'move_challenges_live', (select count(*) from public.challenges c where c.counts = 'move' and c.starts_at <= now() and c.ends_at > now()),
    'move_challenges', (select count(*) from public.challenges c where c.counts = 'move'),
    'hand_cap_min', (select hand_cap_min from public.move_config where id))
  into res;
  return res;
end;
$$;
revoke execute on function public.admin_move_overview() from public, anon;
grant execute on function public.admin_move_overview() to authenticated;

-- p: {"rates": {"yoga": 70, ...}, "hand_cap_min": 120}
create or replace function public.admin_set_move_config(p jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  k text;
begin
  if not exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin) then
    raise exception 'Admins only.';
  end if;
  if p ? 'hand_cap_min' then
    if jsonb_typeof(p -> 'hand_cap_min') <> 'number' or (p ->> 'hand_cap_min')::numeric not between 0 and 1440
       or (p ->> 'hand_cap_min')::numeric <> floor((p ->> 'hand_cap_min')::numeric) then
      raise exception 'Enter whole minutes from 0 to 1,440.';
    end if;
    update public.move_config set hand_cap_min = (p ->> 'hand_cap_min')::int, updated_at = now() where id;
  end if;
  if p ? 'rates' then
    for k in select jsonb_object_keys(p -> 'rates') loop
      if not exists (select 1 from public.move_rates r where r.activity = k) then
        raise exception 'Unknown activity %.', k;
      end if;
      if jsonb_typeof(p -> 'rates' -> k) <> 'number' or (p -> 'rates' ->> k)::numeric not between 0 and 1000
         or (p -> 'rates' ->> k)::numeric <> floor((p -> 'rates' ->> k)::numeric) then
        raise exception 'Enter whole points a minute from 0 to 1,000.';
      end if;
      update public.move_rates set per_min = (p -> 'rates' ->> k)::int, updated_at = now() where activity = k;
    end loop;
  end if;
end;
$$;
revoke execute on function public.admin_set_move_config(jsonb) from public, anon;
grant execute on function public.admin_set_move_config(jsonb) to authenticated;
