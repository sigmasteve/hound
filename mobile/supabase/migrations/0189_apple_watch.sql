-- Hound: the Apple Watch app's server side (Steve: "Let's start the watch
-- build"). The watch signs in without the phone app's help: it shows a
-- six-letter code, and the person enters it on the phone (Settings →
-- Apple Watch). That links the watch to them with its own secret, which
-- only the watch holds (stored here as a hash). From then on the watch
-- calls these functions directly, so it works when the phone app isn't
-- running, and nothing native is needed on the phone.
--
-- Each watch call proves itself with the device id and secret, then acts
-- as its person: auth.uid() is set to them for that call, so the usual
-- functions (log_water, my_goal_streak) run with all their own checks.
--
--   watch_pair_start / watch_pair_status   the code, on the watch
--   link_watch / my_watches / unlink_watch  on the phone
--   watch_today        goals, water and the streak for the watch's day
--   watch_log_water / watch_undo_water      water from the wrist
--   admin_watch_overview                    Admin → Apple Watch
--
-- Run this once, after 0188, in the SQL Editor. It's needed before the
-- watch app's first install (the 0.12.0 build).

create table if not exists public.watch_devices (
  id uuid primary key default gen_random_uuid(),
  secret_hash text not null,
  code text unique,
  code_expires_at timestamptz,
  user_id uuid references public.profiles (id) on delete cascade,
  linked_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists watch_devices_user on public.watch_devices (user_id) where revoked_at is null;
alter table public.watch_devices enable row level security;

-- What people do from the watch, a row a person a day, for Admin.
create table if not exists public.watch_activity (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  opens int not null default 0,
  water_taps int not null default 0,
  primary key (user_id, day)
);
alter table public.watch_activity enable row level security;

revoke all on public.watch_devices, public.watch_activity from anon, authenticated;

create or replace function public.watch_hash(p_secret text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex');
$$;
revoke execute on function public.watch_hash(text) from public, anon, authenticated;

-- ── Pairing ──────────────────────────────────────────────────────────

-- The watch starts: it sends a secret it made (32+ characters) and gets
-- back its id and a code to show, good for 15 minutes.
create or replace function public.watch_pair_start(p_secret text)
returns jsonb
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text;
  d uuid;
begin
  if char_length(coalesce(p_secret, '')) < 32 then
    raise exception 'That watch secret is too short.';
  end if;
  -- Codes nobody used, gone after a day.
  delete from public.watch_devices w where w.user_id is null and w.created_at < now() - interval '1 day';
  loop
    c := '';
    for i in 1..6 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.watch_devices w where w.code = c);
  end loop;
  insert into public.watch_devices (secret_hash, code, code_expires_at)
  values (public.watch_hash(p_secret), c, now() + interval '15 minutes')
  returning id into d;
  return jsonb_build_object('device_id', d, 'code', c);
end;
$$;
revoke execute on function public.watch_pair_start(text) from public;
grant execute on function public.watch_pair_start(text) to anon, authenticated;

-- The watch asks whether its code has been entered yet.
create or replace function public.watch_pair_status(p_device uuid, p_secret text)
returns jsonb
language sql
stable
security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'linked', w.user_id is not null and w.revoked_at is null,
    'expired', w.user_id is null and w.code_expires_at < now(),
    'name', (select split_part(p.name, ' ', 1) from public.profiles p where p.id = w.user_id)
  )
  from public.watch_devices w
  where w.id = p_device and w.secret_hash = public.watch_hash(p_secret);
$$;
revoke execute on function public.watch_pair_status(uuid, text) from public;
grant execute on function public.watch_pair_status(uuid, text) to anon, authenticated;

-- On the phone: the code the watch shows. Returns the watch's id.
create or replace function public.link_watch(p_code text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  d uuid;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  update public.watch_devices w
    set user_id = me, linked_at = now(), code = null, code_expires_at = null
    where w.code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
      and w.user_id is null and w.code_expires_at > now()
    returning w.id into d;
  if d is null then
    raise exception 'That code doesn''t match a watch. Check the code on your watch, or open Hound on it again for a new one.';
  end if;
  return d;
end;
$$;
revoke execute on function public.link_watch(text) from public, anon;
grant execute on function public.link_watch(text) to authenticated;

create or replace function public.my_watches()
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'linked_at', w.linked_at, 'last_seen_at', w.last_seen_at) order by w.linked_at desc), '[]'::jsonb)
  from public.watch_devices w
  where w.user_id = auth.uid() and w.revoked_at is null;
$$;
revoke execute on function public.my_watches() from public, anon;
grant execute on function public.my_watches() to authenticated;

create or replace function public.unlink_watch(p_device uuid)
returns void
language sql
security definer set search_path = public
as $$
  update public.watch_devices w set revoked_at = now() where w.id = p_device and w.user_id = auth.uid();
$$;
revoke execute on function public.unlink_watch(uuid) from public, anon;
grant execute on function public.unlink_watch(uuid) to authenticated;

-- ── Acting as the watch's person ─────────────────────────────────────

-- The person a linked watch belongs to, made auth.uid() for the rest of
-- this call. Anything else is refused.
create or replace function public.watch_act_as(p_device uuid, p_secret text)
returns uuid
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  u uuid;
begin
  select w.user_id into u from public.watch_devices w
    where w.id = p_device and w.secret_hash = public.watch_hash(p_secret)
      and w.user_id is not null and w.revoked_at is null;
  if u is null then
    raise exception 'This watch isn''t linked. Open Hound on the watch for a code.';
  end if;
  update public.watch_devices w set last_seen_at = now() where w.id = p_device;
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u, 'role', 'authenticated')::text, true);
  return u;
end;
$$;
revoke execute on function public.watch_act_as(uuid, text) from public, anon, authenticated;

-- Goals, water and the streak for the watch's day.
create or replace function public.watch_today(p_device uuid, p_secret text, p_day date)
returns jsonb
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  u uuid := public.watch_act_as(p_device, p_secret);
  streak jsonb;
begin
  insert into public.watch_activity (user_id, day, opens) values (u, p_day, 1)
    on conflict (user_id, day) do update set opens = public.watch_activity.opens + 1;
  begin
    select to_jsonb(s) into streak from public.my_goal_streak(p_day) s;
  exception when others then
    streak := null;
  end;
  return jsonb_build_object(
    'name', (select split_part(p.name, ' ', 1) from public.profiles p where p.id = u),
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object('metric', g.metric, 'period', g.period, 'target', g.target, 'activity', g.activity, 'label', g.label) order by g.sort, g.created_at)
      from public.goals g where g.user_id = u and g.archived_at is null
    ), '[]'::jsonb),
    'water', (
      select jsonb_build_object(
        'target_ml', wg.target_ml, 'glass_ml', wg.glass_ml, 'units', wg.units,
        'today_ml', (select coalesce(sum(l.ml), 0) from public.water_log l where l.user_id = u and l.day = p_day)
      )
      from public.water_goals wg where wg.user_id = u
    ),
    'streak', streak
  );
end;
$$;
revoke execute on function public.watch_today(uuid, text, date) from public;
grant execute on function public.watch_today(uuid, text, date) to anon, authenticated;

-- A glass from the wrist (the person's own glass size unless given),
-- through log_water's own checks. Returns the day's total.
create or replace function public.watch_log_water(p_device uuid, p_secret text, p_day date, p_ml integer default null)
returns integer
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  u uuid := public.watch_act_as(p_device, p_secret);
  ml integer := coalesce(p_ml, (select wg.glass_ml from public.water_goals wg where wg.user_id = u), 237);
begin
  perform public.log_water(p_day, ml);
  insert into public.watch_activity (user_id, day, water_taps) values (u, p_day, 1)
    on conflict (user_id, day) do update set water_taps = public.watch_activity.water_taps + 1;
  return (select coalesce(sum(l.ml), 0)::int from public.water_log l where l.user_id = u and l.day = p_day);
end;
$$;
revoke execute on function public.watch_log_water(uuid, text, date, integer) from public;
grant execute on function public.watch_log_water(uuid, text, date, integer) to anon, authenticated;

-- Undo: the day's latest glass. Returns the day's total.
create or replace function public.watch_undo_water(p_device uuid, p_secret text, p_day date)
returns integer
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  u uuid := public.watch_act_as(p_device, p_secret);
begin
  delete from public.water_log l where l.id = (
    select x.id from public.water_log x where x.user_id = u and x.day = p_day order by x.logged_at desc limit 1
  );
  return (select coalesce(sum(l.ml), 0)::int from public.water_log l where l.user_id = u and l.day = p_day);
end;
$$;
revoke execute on function public.watch_undo_water(uuid, text, date) from public;
grant execute on function public.watch_undo_water(uuid, text, date) to anon, authenticated;

-- ── Admin ────────────────────────────────────────────────────────────

create or replace function public.admin_watch_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  return jsonb_build_object(
    'linked', (select count(*) from public.watch_devices w where w.user_id is not null and w.revoked_at is null),
    'people', (select count(distinct w.user_id) from public.watch_devices w where w.user_id is not null and w.revoked_at is null),
    'seen_24h', (select count(distinct w.user_id) from public.watch_devices w where w.revoked_at is null and w.last_seen_at > now() - interval '24 hours'),
    'seen_7d', (select count(distinct w.user_id) from public.watch_devices w where w.revoked_at is null and w.last_seen_at > now() - interval '7 days'),
    'opens_7d', (select coalesce(sum(a.opens), 0) from public.watch_activity a where a.day > current_date - 7),
    'water_taps_7d', (select coalesce(sum(a.water_taps), 0) from public.watch_activity a where a.day > current_date - 7),
    'water_people_7d', (select count(distinct a.user_id) from public.watch_activity a where a.day > current_date - 7 and a.water_taps > 0)
  );
end;
$$;
revoke execute on function public.admin_watch_overview() from public, anon;
grant execute on function public.admin_watch_overview() to authenticated;
