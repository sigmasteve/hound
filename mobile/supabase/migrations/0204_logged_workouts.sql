-- Hound: log a workout by hand, for people without a watch.
--
-- A logged workout is a workout_history row with source 'manual':
--   - logged_min holds the minutes entered (full);
--   - duration_min holds what the games see: the minutes × Admin's value
--     (half by default). Every server game already reads duration_min
--     (the sports bonuses, Golf power), so they get half with no change,
--     while "did you work out" checks (Daily Doors, Hound'opoly) see the
--     row and count it in full. The phone merges logged workouts into
--     Goals, Bingo, 75 Day and checklists at full minutes (logged_min).
--   - no distance and no heart rate, ever.
--
-- The rules, all checked here: up to 2 a day, 5 to 90 minutes, today or
-- yesterday and never the future, no overlap with any other workout,
-- accounts younger than a week can't log, undo within 15 minutes (it
-- still counts towards the day's 2), and a workout from a phone or watch
-- over the same time replaces a logged one.
--
-- Also closes a hole: clients could write workout_history directly; now
-- they can't write or change a 'manual' row (only log_workout can).
--
-- Admin: workout_log_config, admin_workout_log_overview (numbers, who's
-- worth a look, who's blocked), admin_set_workout_log_config and
-- admin_block_workout_logging.

-- ── Settings ──

create table if not exists public.workout_log_config (
  id boolean primary key default true,
  constraint workout_log_config_singleton check (id),
  enabled boolean not null default true,
  per_day integer not null default 2 check (per_day between 1 and 10),
  min_min integer not null default 5 check (min_min between 1 and 60),
  max_min integer not null default 90 check (max_min between 5 and 300),
  back_days integer not null default 1 check (back_days between 0 and 7),
  value_pct integer not null default 50 check (value_pct between 0 and 100),
  new_account_days integer not null default 7 check (new_account_days between 0 and 60),
  undo_minutes integer not null default 15 check (undo_minutes between 0 and 120),
  updated_at timestamptz not null default now(),
  constraint workout_log_config_range check (min_min <= max_min)
);
insert into public.workout_log_config (id) values (true) on conflict (id) do nothing;
alter table public.workout_log_config enable row level security;
revoke all on public.workout_log_config from public, anon, authenticated;

-- ── What's logged ──

alter table public.workout_history add column if not exists logged_min integer;

-- Every log, kept after an undo or a replacement, so undoing doesn't give
-- a log back and Admin sees all of it.
create table if not exists public.workout_log_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  source_id text not null unique,
  type text not null,
  minutes integer not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  local_day date not null,
  phone_steps integer,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  replaced_at timestamptz
);
create index if not exists workout_log_entries_user_day on public.workout_log_entries (user_id, local_day);
create index if not exists workout_log_entries_created on public.workout_log_entries (created_at);
alter table public.workout_log_entries enable row level security;
revoke all on public.workout_log_entries from public, anon, authenticated;

-- People Admin has turned logging off for.
create table if not exists public.workout_log_blocks (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  blocked_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.workout_log_blocks enable row level security;
revoke all on public.workout_log_blocks from public, anon, authenticated;

-- ── Clients can't write a logged workout themselves ──

drop policy if exists "Users can record their own workout history" on public.workout_history;
drop policy if exists "Users can update their own workout history" on public.workout_history;

create policy "Users can record their own workout history"
  on public.workout_history for insert
  to authenticated
  with check (user_id = auth.uid() and source <> 'manual');

create policy "Users can update their own workout history"
  on public.workout_history for update
  to authenticated
  using (user_id = auth.uid() and source <> 'manual')
  with check (user_id = auth.uid() and source <> 'manual');

-- ── Helpers ──

-- The name a type is written as, so the existing name patterns (sports
-- bonuses, Golf power) classify it; null for an unknown type.
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
    when 'other' then 'Other'
  end;
$$;
revoke execute on function public.workout_log_name(text) from public, anon, authenticated;

create or replace function public.workout_log_tz(p_user uuid)
returns text
language sql
stable
security definer set search_path = public
as $$
  select coalesce((select p.time_zone from public.profiles p where p.id = p_user), 'America/New_York');
$$;
revoke execute on function public.workout_log_tz(uuid) from public, anon, authenticated;

-- Whole days until someone's account is old enough to log (0 once it is).
create or replace function public.workout_log_opens_in(p_user uuid)
returns integer
language sql
stable
security definer set search_path = public
as $$
  select greatest(0, ceil(extract(epoch from (
    p.created_at + make_interval(days => (select c.new_account_days from public.workout_log_config c where c.id)) - now())) / 86400.0))::int
  from public.profiles p where p.id = p_user;
$$;
revoke execute on function public.workout_log_opens_in(uuid) from public, anon, authenticated;

-- One entry as the app reads it.
create or replace function public.workout_log_json(e public.workout_log_entries)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'source_id', e.source_id,
    'type', e.type,
    'name', public.workout_log_name(e.type),
    'minutes', e.minutes,
    'counts_as', coalesce((select w.duration_min from public.workout_history w
                           where w.user_id = e.user_id and w.source_id = e.source_id),
                          round(e.minutes * c.value_pct / 100.0)::int),
    'started_at', e.started_at,
    'ended_at', e.ended_at,
    'local_day', e.local_day,
    'undo_until', case when e.undone_at is null and e.replaced_at is null
                        and now() < e.created_at + make_interval(mins => c.undo_minutes)
                       then e.created_at + make_interval(mins => c.undo_minutes) end,
    'undone', e.undone_at is not null,
    'replaced', e.replaced_at is not null)
  from public.workout_log_config c where c.id;
$$;
revoke execute on function public.workout_log_json(public.workout_log_entries) from public, anon, authenticated;

-- ── Logging one ──

create or replace function public.log_workout(p_type text, p_minutes int, p_ended_at timestamptz, p_phone_steps int default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  cfg public.workout_log_config%rowtype;
  tz text;
  today date;
  day date;
  started timestamptz;
  opens int;
  n int;
  clash record;
  e public.workout_log_entries%rowtype;
  v_name text := public.workout_log_name(p_type);
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into cfg from public.workout_log_config where id;
  if not cfg.enabled then
    raise exception 'Logging workouts is paused right now.';
  end if;
  if exists (select 1 from public.workout_log_blocks b where b.user_id = me) then
    raise exception 'Logging is off for your account. Workouts from a watch or your phone still count.';
  end if;
  opens := coalesce(public.workout_log_opens_in(me), 0);
  if opens > 0 then
    raise exception 'Logging opens after your first week. In % %. Until then, workouts from a watch or your phone count.',
      opens, case when opens = 1 then 'day' else 'days' end;
  end if;
  if v_name is null then
    raise exception 'Pick what you did.';
  end if;
  if p_minutes is null or p_minutes < cfg.min_min or p_minutes > cfg.max_min then
    raise exception 'Between % and % minutes.', cfg.min_min, cfg.max_min;
  end if;

  tz := public.workout_log_tz(me);
  today := (now() at time zone tz)::date;
  if p_ended_at is null or p_ended_at > now() + interval '1 minute' then
    raise exception 'That hasn''t happened yet.';
  end if;
  day := (p_ended_at at time zone tz)::date;
  if day > today or day < today - cfg.back_days then
    raise exception '%', case when cfg.back_days = 0 then 'Only today.'
                              when cfg.back_days = 1 then 'Only today or yesterday.'
                              else format('Only today or the %s days before.', cfg.back_days) end;
  end if;

  -- One at a time per person, so two quick taps can't both slip under the limit.
  perform pg_advisory_xact_lock(hashtext('workout_log:' || me::text));
  select count(*) into n from public.workout_log_entries x where x.user_id = me and x.local_day = day;
  if n >= cfg.per_day then
    raise exception '%', case when day = today then format('That''s %s logged today. More tomorrow.', cfg.per_day)
                              else format('That''s %s logged for yesterday.', cfg.per_day) end;
  end if;

  started := p_ended_at - make_interval(mins => p_minutes);
  select w.name, w.occurred_at into clash
    from public.workout_history w
    where w.user_id = me
      and w.occurred_at < p_ended_at
      and w.occurred_at + make_interval(mins => greatest(coalesce(w.logged_min, w.duration_min, 0), 1)) > started
    order by w.occurred_at
    limit 1;
  if found then
    raise exception 'That overlaps your % at %.', lower(clash.name),
      ltrim(to_char(clash.occurred_at at time zone tz, 'HH12:MI am'), '0');
  end if;

  insert into public.workout_log_entries (user_id, source_id, type, minutes, started_at, ended_at, local_day, phone_steps)
  values (me, 'manual:' || gen_random_uuid()::text, p_type, p_minutes, started, p_ended_at, day,
          case when p_phone_steps is null or p_phone_steps < 0 then null else p_phone_steps end)
  returning * into e;

  insert into public.workout_history (user_id, source_id, name, occurred_at, source, distance_mi, avg_heart_rate, duration_min, logged_min)
  values (me, e.source_id, v_name, started, 'manual', null, null, round(p_minutes * cfg.value_pct / 100.0)::int, p_minutes);

  return public.workout_log_json(e) || jsonb_build_object(
    'left_today', greatest(0, cfg.per_day - (select count(*) from public.workout_log_entries x where x.user_id = me and x.local_day = today)));
end;
$$;
revoke execute on function public.log_workout(text, int, timestamptz, int) from public, anon;
grant execute on function public.log_workout(text, int, timestamptz, int) to authenticated;

-- Undo, within Admin's window (15 minutes). It still counts towards the
-- day's limit.
create or replace function public.undo_logged_workout(p_source_id text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  cfg public.workout_log_config%rowtype;
  e public.workout_log_entries%rowtype;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into cfg from public.workout_log_config where id;
  select * into e from public.workout_log_entries x where x.source_id = p_source_id and x.user_id = me for update;
  if not found then
    raise exception 'That workout isn''t one you logged.';
  end if;
  if e.undone_at is not null or e.replaced_at is not null then
    return;
  end if;
  if now() >= e.created_at + make_interval(mins => cfg.undo_minutes) then
    raise exception 'It''s been more than % minutes: it stands now.', cfg.undo_minutes;
  end if;
  delete from public.workout_history w where w.user_id = me and w.source_id = p_source_id;
  update public.workout_log_entries set undone_at = now() where id = e.id;
end;
$$;
revoke execute on function public.undo_logged_workout(text) from public, anon;
grant execute on function public.undo_logged_workout(text) to authenticated;

-- A workout from a phone or watch over the same time replaces a logged one.
create or replace function public.workout_log_replace()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  ends timestamptz := new.occurred_at + make_interval(mins => greatest(coalesce(new.duration_min, 0), 1));
begin
  with gone as (
    delete from public.workout_history w
    where w.user_id = new.user_id
      and w.source = 'manual'
      and w.occurred_at < ends
      and w.occurred_at + make_interval(mins => greatest(coalesce(w.logged_min, w.duration_min, 0), 1)) > new.occurred_at
    returning w.source_id
  )
  update public.workout_log_entries e set replaced_at = now()
    from gone where e.source_id = gone.source_id and e.replaced_at is null;
  return new;
end;
$$;
revoke execute on function public.workout_log_replace() from public, anon, authenticated;

drop trigger if exists workout_log_replace on public.workout_history;
create trigger workout_log_replace
  after insert or update of occurred_at, duration_min on public.workout_history
  for each row when (new.source <> 'manual')
  execute procedure public.workout_log_replace();

-- ── Reading mine ──

create or replace function public.my_logged_workouts()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  cfg public.workout_log_config%rowtype;
  today date;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into cfg from public.workout_log_config where id;
  today := (now() at time zone public.workout_log_tz(me))::date;
  return jsonb_build_object(
    'enabled', cfg.enabled,
    'blocked', exists (select 1 from public.workout_log_blocks b where b.user_id = me),
    'opens_in_days', coalesce(public.workout_log_opens_in(me), 0),
    'per_day', cfg.per_day,
    'min_min', cfg.min_min,
    'max_min', cfg.max_min,
    'back_days', cfg.back_days,
    'value_pct', cfg.value_pct,
    'undo_minutes', cfg.undo_minutes,
    'left_today', greatest(0, cfg.per_day - (select count(*) from public.workout_log_entries x where x.user_id = me and x.local_day = today)),
    'left_yesterday', greatest(0, cfg.per_day - (select count(*) from public.workout_log_entries x where x.user_id = me and x.local_day = today - 1)),
    'logs', (select coalesce(jsonb_agg(public.workout_log_json(x) order by x.ended_at desc), '[]'::jsonb)
             from public.workout_log_entries x
             where x.user_id = me and x.local_day >= today - greatest(cfg.back_days, 1)));
end;
$$;
revoke execute on function public.my_logged_workouts() from public, anon;
grant execute on function public.my_logged_workouts() to authenticated;

-- ── Admin ──

create or replace function public.admin_workout_log_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  cfg public.workout_log_config%rowtype;
  since timestamptz := now() - interval '7 days';
  all_7d int;
  manual_7d int;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  select * into cfg from public.workout_log_config where id;
  select count(*), count(*) filter (where w.source = 'manual') into all_7d, manual_7d
    from public.workout_history w where w.occurred_at >= since;

  return jsonb_build_object(
    'config', jsonb_build_object('enabled', cfg.enabled, 'per_day', cfg.per_day, 'min_min', cfg.min_min,
      'max_min', cfg.max_min, 'back_days', cfg.back_days, 'value_pct', cfg.value_pct,
      'new_account_days', cfg.new_account_days, 'undo_minutes', cfg.undo_minutes),
    'people_7d', (select count(distinct e.user_id) from public.workout_log_entries e where e.created_at >= since and e.undone_at is null),
    'logs_7d', (select count(*) from public.workout_log_entries e where e.created_at >= since and e.undone_at is null),
    'minutes_7d', (select coalesce(sum(e.minutes), 0) from public.workout_log_entries e where e.created_at >= since and e.undone_at is null),
    'share_7d', case when all_7d = 0 then 0 else round(manual_7d::numeric / all_7d, 3) end,
    'undone_7d', (select count(*) from public.workout_log_entries e where e.created_at >= since and e.undone_at is not null),
    'replaced_7d', (select count(*) from public.workout_log_entries e where e.created_at >= since and e.replaced_at is not null),
    'by_type', (select coalesce(jsonb_object_agg(t.type, t.n), '{}'::jsonb) from (
        select e.type, count(*) as n from public.workout_log_entries e
        where e.created_at >= since and e.undone_at is null group by e.type) t),
    'flagged', (select coalesce(jsonb_agg(jsonb_build_object(
          'user_id', f.user_id, 'name', public.golf_name(f.user_id), 'why', f.why,
          'blocked', exists (select 1 from public.workout_log_blocks b where b.user_id = f.user_id))
          order by f.ord, f.user_id), '[]'::jsonb)
        from (
          -- At the limit on 10 or more of the last 14 days.
          (select d.user_id, 1 as ord, format('At the limit %s of the last 14 days', count(*)) as why
          from (
            select e.user_id, e.local_day from public.workout_log_entries e
            where e.local_day >= current_date - 14
            group by e.user_id, e.local_day having count(*) >= cfg.per_day
          ) d
          group by d.user_id having count(*) >= 10)
          union all
          -- A walk or run with far fewer steps than the minutes (the latest).
          (select distinct on (e.user_id) e.user_id, 2,
            format('Logged a %s min %s with %s steps in that time', e.minutes,
              case e.type when 'run' then 'run' else 'walk' end, e.phone_steps)
          from public.workout_log_entries e
          where e.created_at >= now() - interval '14 days' and e.type in ('walk', 'run')
            and e.phone_steps is not null and e.phone_steps < e.minutes * 30
          order by e.user_id, e.created_at desc)
        ) f),
    'blocked', (select coalesce(jsonb_agg(jsonb_build_object('user_id', b.user_id, 'name', public.golf_name(b.user_id))
          order by b.created_at desc), '[]'::jsonb) from public.workout_log_blocks b)
  );
end;
$$;
revoke execute on function public.admin_workout_log_overview() from public, anon;
grant execute on function public.admin_workout_log_overview() to authenticated;

create or replace function public.admin_set_workout_log_config(p jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.workout_log_config%rowtype;
begin
  if not exists (select 1 from public.profiles x where x.id = auth.uid() and x.is_admin) then
    raise exception 'not authorized';
  end if;
  select * into c from public.workout_log_config where id;
  update public.workout_log_config set
    enabled = coalesce((p ->> 'enabled')::boolean, c.enabled),
    per_day = coalesce((p ->> 'per_day')::int, c.per_day),
    min_min = coalesce((p ->> 'min_min')::int, c.min_min),
    max_min = coalesce((p ->> 'max_min')::int, c.max_min),
    back_days = coalesce((p ->> 'back_days')::int, c.back_days),
    value_pct = coalesce((p ->> 'value_pct')::int, c.value_pct),
    new_account_days = coalesce((p ->> 'new_account_days')::int, c.new_account_days),
    undo_minutes = coalesce((p ->> 'undo_minutes')::int, c.undo_minutes),
    updated_at = now()
  where id;
end;
$$;
revoke execute on function public.admin_set_workout_log_config(jsonb) from public, anon;
grant execute on function public.admin_set_workout_log_config(jsonb) to authenticated;

create or replace function public.admin_block_workout_logging(p_user uuid, p_block boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles x where x.id = auth.uid() and x.is_admin) then
    raise exception 'not authorized';
  end if;
  if p_block then
    insert into public.workout_log_blocks (user_id, blocked_by) values (p_user, auth.uid())
    on conflict (user_id) do nothing;
  else
    delete from public.workout_log_blocks where user_id = p_user;
  end if;
end;
$$;
revoke execute on function public.admin_block_workout_logging(uuid, boolean) from public, anon;
grant execute on function public.admin_block_workout_logging(uuid, boolean) to authenticated;
